import { prisma } from '../db/client.js';
import { mind24ShortAssignmentCode, normalizeAccessCodeInput } from '../utils/accessCode.js';
import {
  isCandidateLobbyModuleKey,
  moduleMetaForKey,
  resolveModuleKey,
} from '../utils/moduleCatalog.js';

const ASSIGNMENT_LOBBY_INCLUDE = {
  assessmentDefinition: {
    select: { id: true, name: true, key: true, version: true, config: true },
  },
  attempts: {
    select: { moduleKey: true, status: true, submittedAt: true, results: true },
  },
};

function readCompletedModules(assignment) {
  const raw = assignment.completedModules;
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => resolveModuleKey(String(x)));
}

function attemptLooksCompleted(att) {
  if (!att) return false;
  if (att.status === 'submitted' || att.status === 'completed') return true;
  if (att.submittedAt) return true;
  const results = att.results;
  if (results && typeof results === 'object') {
    const status = String(results.status || '').trim().toUpperCase();
    if (status === 'COMPLETED' || status === 'SUBMITTED') return true;
    if (results.submitted === true || results.completed === true) return true;
  }
  return false;
}

function submittedModuleKeys(assignment) {
  const keys = new Set();
  for (const att of assignment.attempts || []) {
    if (attemptLooksCompleted(att) && att.moduleKey) {
      keys.add(resolveModuleKey(String(att.moduleKey)));
    }
  }
  return keys;
}

function completedModuleKeys(assignment) {
  const done = new Set(readCompletedModules(assignment));
  for (const k of submittedModuleKeys(assignment)) done.add(k);
  return done;
}

/** Solo módulos explícitamente asignados; nunca el catálogo completo ni dimensiones JSON legacy. */
function assignedModuleKeys(assignment) {
  const raw = assignment.selectedModules;
  if (Array.isArray(raw) && raw.length) {
    const keys = raw
      .map((x) => resolveModuleKey(String(x)))
      .filter((k) => isCandidateLobbyModuleKey(k));
    return [...new Set(keys)];
  }
  const inferred = new Set();
  readCompletedModules(assignment).forEach((k) => {
    if (isCandidateLobbyModuleKey(k)) inferred.add(k);
  });
  for (const att of assignment.attempts || []) {
    if (
      att.moduleKey &&
      (att.status === 'in_progress' || attemptLooksCompleted(att))
    ) {
      const rk = resolveModuleKey(String(att.moduleKey));
      if (isCandidateLobbyModuleKey(rk)) inferred.add(rk);
    }
  }
  return [...inferred];
}

function modulesFromAssignment(assignment) {
  const keys = assignedModuleKeys(assignment);
  if (!keys.length) return [];

  const done = completedModuleKeys(assignment);
  return keys
    .map((storeKey) => {
      const resolved = moduleMetaForKey(storeKey);
      return {
        key: storeKey,
        label: resolved.label,
        description: resolved.description || '',
        icon: resolved.icon,
        estimatedMinutes: resolved.estimatedMinutes,
        estimatedTime: resolved.estimatedMinutes,
        featured: !!resolved.featured,
        assignmentId: assignment.id,
        completed: done.has(storeKey),
      };
    })
    .filter((m) => isCandidateLobbyModuleKey(m.key));
}

function assignmentStillPending(assignment) {
  const st = String(assignment?.status || '').toLowerCase();
  if (st === 'completed' || st === 'archived') return false;
  const mods = modulesFromAssignment(assignment);
  return mods.some((m) => !m.completed);
}

function isLobbyRelevantAssignment(assignment) {
  const st = String(assignment?.status || '').toLowerCase();
  if (st === 'completed' || st === 'archived') return false;
  const mods = modulesFromAssignment(assignment);
  if (!mods.length) return false;
  return mods.some((m) => !m.completed);
}

/** Solo módulos genuinamente pendientes (nunca envía completados al cliente). */
function lobbyModulesForAssignment(assignment) {
  const st = String(assignment?.status || '').toLowerCase();
  if (st === 'completed' || st === 'archived') return [];
  return modulesFromAssignment(assignment).filter((m) => !m.completed);
}

function mapAssignmentRow(a) {
  return {
    id: a.id,
    status: a.status,
    accessCode: mind24ShortAssignmentCode(a.id),
    assessment: a.assessmentDefinition
      ? {
          id: a.assessmentDefinition.id,
          name: a.assessmentDefinition.name,
          key: a.assessmentDefinition.key,
        }
      : null,
    modules: modulesFromAssignment(a),
  };
}

function invalidAccessError() {
  const err = new Error('Credenciales inválidas o prueba no asignada.');
  err.code = 'INVALID_CANDIDATE_ACCESS';
  return err;
}

/**
 * Valida correo + clave de acceso contra una asignación real.
 * Rechaza si no hay coincidencia o si la prueba ya está completada.
 */
export async function authenticateCandidateByAccess({ email, accessCode }) {
  const em = email.trim().toLowerCase();
  const code = normalizeAccessCodeInput(accessCode);
  if (!em || !code) throw invalidAccessError();

  const user = await prisma.user.findUnique({
    where: { email: em },
    include: {
      organization: true,
      candidateProfile: true,
    },
  });

  if (!user || user.role !== 'candidato' || !user.candidateProfile) {
    throw invalidAccessError();
  }

  assertCandidateOrgAccess(user);

  const assignments = await prisma.assignment.findMany({
    where: {
      candidateId: user.candidateProfile.id,
      status: { not: 'archived' },
    },
    include: ASSIGNMENT_LOBBY_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });

  const matched = assignments.filter((a) => mind24ShortAssignmentCode(a.id) === code);
  if (!matched.length) {
    throw invalidAccessError();
  }

  const assignment = matched[0];
  if (!isLobbyRelevantAssignment(assignment)) {
    throw invalidAccessError();
  }

  const pending = assignments.filter(isLobbyRelevantAssignment);
  const modules = lobbyModulesForAssignment(assignment);

  return {
    user,
    assignmentId: assignment.id,
    accessCode: code,
    modules,
    assignments: pending.map(mapAssignmentRow),
  };
}

/** Lobby para sesión ya autenticada (login con contraseña). */
export async function getCandidateLobbyForUser(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { organization: true, candidateProfile: true },
  });
  if (!user || user.role !== 'candidato' || !user.candidateProfile) {
    const err = new Error('NOT_CANDIDATE');
    err.code = 'NOT_CANDIDATE';
    throw err;
  }
  assertCandidateOrgAccess(user);

  const assignments = await prisma.assignment.findMany({
    where: {
      candidateId: user.candidateProfile.id,
      status: { not: 'archived' },
    },
    include: ASSIGNMENT_LOBBY_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });

  const active = assignments.filter(isLobbyRelevantAssignment);
  const primary = active[0] || null;
  const modules = primary ? lobbyModulesForAssignment(primary) : [];

  return {
    user,
    assignmentId: primary?.id ?? null,
    modules,
    assignments: active.map(mapAssignmentRow),
  };
}

function assertCandidateOrgAccess(user) {
  if (user.organization?.blocked) {
    const err = new Error('La organización está suspendida. Contacta a soporte.');
    err.code = 'ORG_BLOCKED';
    throw err;
  }
  if (user.organizationId && !user.organization?.empresaPortalEnabled) {
    const err = new Error(
      'Tu empresa no está habilitada en la plataforma. El administrador general debe registrar la empresa antes de que puedas acceder.',
    );
    err.code = 'EMPRESA_NOT_PROVISIONED';
    throw err;
  }
}
