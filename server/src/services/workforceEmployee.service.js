import { prisma } from '../db/client.js';
import { isValidIanaTimezone } from '../utils/ianaTimezone.js';
import {
  buildTimeclockAccessLink,
  generateTimeclockAccessToken,
  hashTimeclockToken,
  resolveTimeclockPublicLinkBase,
} from './timeclockToken.service.js';
import {
  buildAdminJornadaPayload,
  getLatestSessionForEmployee,
  getOpenSessionForEmployee,
} from './remoteWorkSession.service.js';
import {
  aggregateWorkforceTaskSummariesForOrg,
  workforceTaskSummaryForEmployee,
} from './workforceTaskSummary.service.js';

function timeclockLinkBase() {
  const base = resolveTimeclockPublicLinkBase();
  console.log(`[timeclock] public link base: ${base}`);
  return base;
}

export async function assertWorkforceEmployeeInOrg(employeeId, organizationId) {
  const emp = await prisma.workforceEmployee.findFirst({
    where: { id: employeeId, organizationId },
  });
  if (!emp) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    err.message = 'Colaborador no encontrado.';
    throw err;
  }
  return emp;
}

export function sanitizeEmployeeForAdmin(emp) {
  return {
    id: emp.id,
    fullName: emp.fullName,
    employeeCode: emp.employeeCode,
    position: emp.position,
    department: emp.department,
    timezone: emp.timezone,
    isActive: emp.isActive,
    tokenVersion: emp.tokenVersion,
    createdAt: emp.createdAt,
    updatedAt: emp.updatedAt,
  };
}

export async function listWorkforceEmployees(organizationId) {
  const [rows, summaryMap] = await Promise.all([
    prisma.workforceEmployee.findMany({
      where: { organizationId },
      orderBy: { fullName: 'asc' },
    }),
    aggregateWorkforceTaskSummariesForOrg(organizationId),
  ]);
  return rows.map((emp) => ({
    ...sanitizeEmployeeForAdmin(emp),
    taskSummary: workforceTaskSummaryForEmployee(summaryMap, emp.id),
  }));
}

export async function getWorkforceEmployeeForOrg(organizationId, employeeId) {
  const emp = await assertWorkforceEmployeeInOrg(employeeId, organizationId);
  const open = await getOpenSessionForEmployee(emp.id);
  const latest = open ? open : await getLatestSessionForEmployee(emp.id);
  const jornada = buildAdminJornadaPayload(open, latest);
  return {
    employee: sanitizeEmployeeForAdmin(emp),
    jornada: {
      ...jornada,
      openSession: jornada.session && !jornada.session.checkOutAt ? jornada.session : null,
    },
  };
}

export async function createWorkforceEmployee(organizationId, data) {
  if (!isValidIanaTimezone(data.timezone)) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Zona horaria IANA inválida.';
    throw err;
  }
  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org || org.blocked) {
    const err = new Error('ORG_BLOCKED');
    err.code = 'ORG_BLOCKED';
    throw err;
  }
  const { token, hash } = generateTimeclockAccessToken();
  const emp = await prisma.workforceEmployee.create({
    data: {
      organizationId,
      fullName: data.fullName.trim(),
      employeeCode: data.employeeCode?.trim() || null,
      position: data.position?.trim() || null,
      department: data.department?.trim() || null,
      timezone: data.timezone.trim(),
      isActive: data.isActive ?? true,
      accessTokenHash: hash,
      tokenVersion: 1,
    },
  });
  return {
    employee: sanitizeEmployeeForAdmin(emp),
    accessLink: buildTimeclockAccessLink(token, timeclockLinkBase()),
  };
}

export async function updateWorkforceEmployee(organizationId, employeeId, data) {
  await assertWorkforceEmployeeInOrg(employeeId, organizationId);
  if (data.timezone != null && !isValidIanaTimezone(data.timezone)) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Zona horaria IANA inválida.';
    throw err;
  }
  const emp = await prisma.workforceEmployee.update({
    where: { id: employeeId },
    data: {
      ...(data.fullName != null ? { fullName: data.fullName.trim() } : {}),
      ...(data.employeeCode !== undefined
        ? { employeeCode: data.employeeCode?.trim() || null }
        : {}),
      ...(data.position !== undefined ? { position: data.position?.trim() || null } : {}),
      ...(data.department !== undefined ? { department: data.department?.trim() || null } : {}),
      ...(data.timezone != null ? { timezone: data.timezone.trim() } : {}),
      ...(data.isActive != null ? { isActive: data.isActive } : {}),
    },
  });
  return sanitizeEmployeeForAdmin(emp);
}

export async function regenerateWorkforceEmployeeToken(organizationId, employeeId) {
  const existing = await assertWorkforceEmployeeInOrg(employeeId, organizationId);
  const { token, hash } = generateTimeclockAccessToken();
  const emp = await prisma.workforceEmployee.update({
    where: { id: existing.id },
    data: {
      accessTokenHash: hash,
      tokenVersion: existing.tokenVersion + 1,
    },
  });
  return {
    employee: sanitizeEmployeeForAdmin(emp),
    accessLink: buildTimeclockAccessLink(token, timeclockLinkBase()),
  };
}

/** Exchange: lookup by hash only (no raw token stored). */
export async function findEmployeeByTokenForExchange(token) {
  const hash = hashTimeclockToken(token);
  const emp = await prisma.workforceEmployee.findUnique({
    where: { accessTokenHash: hash },
    include: { organization: true },
  });
  if (!emp) return null;
  return emp;
}

export async function loadWorkforceEmployeeForSession(employeeId) {
  return prisma.workforceEmployee.findUnique({
    where: { id: employeeId },
    include: { organization: true },
  });
}

export function assertEmployeeEligibleForTimeclock(emp) {
  if (!emp?.isActive) {
    const err = new Error('FORBIDDEN');
    err.code = 'FORBIDDEN';
    err.message = 'Acceso desactivado.';
    throw err;
  }
  if (!emp.organization || emp.organization.blocked || !emp.organization.empresaPortalEnabled) {
    const err = new Error('ORG_BLOCKED');
    err.code = 'ORG_BLOCKED';
    throw err;
  }
}
