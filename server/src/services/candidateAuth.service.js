import { prisma } from '../db/client.js';
import { mind24ShortAssignmentCode, normalizeAccessCodeInput } from '../utils/accessCode.js';
import { moduleMetaForKey, resolveModuleKey } from '../utils/moduleCatalog.js';

function readCompletedModules(assignment) {
  const raw = assignment.completedModules;
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => String(x));
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

function modulesFromAssignment(assignment) {
  const raw = assignment.selectedModules;
  let keys = [];
  if (Array.isArray(raw) && raw.length) {
    keys = raw.map((x) => String(x));
  } else {
    const dims = assignment.assessmentDefinition?.config?.dimensions;
    if (Array.isArray(dims)) {
      keys = dims.map((d) => d.id || d.label).filter(Boolean);
    }
  }
  if (!keys.length && assignment.assessmentDefinition?.name) {
    return [
      {
        key: assignment.assessmentDefinition.key || 'eval',
        label: assignment.assessmentDefinition.name,
        assignmentId: assignment.id,
      },
    ];
  }
  const done = new Set(readCompletedModules(assignment));
  return keys.map((key) => {
    const resolved = moduleMetaForKey(key);
    const storeKey = resolveModuleKey(key);
    return {
      key: storeKey,
      label: resolved.label,
      description: resolved.description || '',
      icon: resolved.icon,
      estimatedMinutes: resolved.estimatedMinutes,
      estimatedTime: resolved.estimatedMinutes,
      featured: !!resolved.featured,
      assignmentId: assignment.id,
      completed: done.has(storeKey) || done.has(key),
    };
  });
}

function assignmentStillPending(assignment) {
  const keys = modulesFromAssignment(assignment).map((m) => m.key);
  const done = new Set(readCompletedModules(assignment));
  return keys.some((k) => !done.has(k));
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
    where: { candidateId: user.candidateProfile.id },
    include: {
      assessmentDefinition: { select: { id: true, name: true, key: true, version: true, config: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const matched = assignments.filter((a) => mind24ShortAssignmentCode(a.id) === code);
  if (!matched.length) {
    throw invalidAccessError();
  }

  const assignment = matched[0];
  if (assignment.status === 'completed' && !assignmentStillPending(assignment)) {
    throw invalidAccessError();
  }

  const pending = assignments.filter(
    (a) => a.status !== 'completed' || assignmentStillPending(a),
  );
  const allMods = modulesFromAssignment(assignment);
  const modules = allMods.filter((m) => !m.completed);

  return {
    user,
    assignmentId: assignment.id,
    accessCode: code,
    modules: modules.length ? modules : allMods,
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
    where: { candidateId: user.candidateProfile.id },
    include: {
      assessmentDefinition: { select: { id: true, name: true, key: true, version: true, config: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const pending = assignments.filter(
    (a) => a.status !== 'completed' || assignmentStillPending(a),
  );
  const primary = pending[0] || null;
  const allMods = primary ? modulesFromAssignment(primary) : [];
  const openMods = allMods.filter((m) => !m.completed);

  return {
    user,
    assignmentId: primary?.id ?? null,
    modules: openMods.length ? openMods : allMods,
    assignments: pending.map(mapAssignmentRow),
  };
}
