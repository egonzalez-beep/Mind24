import { prisma } from '../db/client.js';
import { assertWorkforceEmployeeInOrg } from './workforceEmployee.service.js';
import { assertRecruitmentVacancyInOrg } from './recruitmentVacancy.service.js';

export const RECRUITMENT_ASSIGNEE_ROLES = ['PRIMARY', 'SUPPORT'];

function serializeAssignee(row) {
  return {
    id: row.id,
    vacancyId: row.vacancyId,
    employeeId: row.employeeId,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
    employee: row.employee
      ? {
          id: row.employee.id,
          fullName: row.employee.fullName,
          position: row.employee.position,
          department: row.employee.department,
        }
      : undefined,
  };
}

export async function listVacancyAssignees(organizationId, vacancyId) {
  await assertRecruitmentVacancyInOrg(vacancyId, organizationId);
  const rows = await prisma.recruitmentVacancyAssignee.findMany({
    where: { organizationId, vacancyId },
    include: { employee: true },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
  });
  return rows.map(serializeAssignee);
}

export async function setVacancyAssignee({ organizationId, vacancyId, employeeId, role }) {
  if (!RECRUITMENT_ASSIGNEE_ROLES.includes(role)) {
    const err = new Error('VALIDATION_ERROR');
    err.code = 'VALIDATION_ERROR';
    err.message = 'Rol de asignación inválido.';
    throw err;
  }
  await assertRecruitmentVacancyInOrg(vacancyId, organizationId);
  await assertWorkforceEmployeeInOrg(employeeId, organizationId);

  return prisma.$transaction(async (tx) => {
    if (role === 'PRIMARY') {
      await tx.recruitmentVacancyAssignee.deleteMany({
        where: { vacancyId, role: 'PRIMARY' },
      });
    }

    const row = await tx.recruitmentVacancyAssignee.upsert({
      where: { vacancyId_employeeId: { vacancyId, employeeId } },
      create: {
        organizationId,
        vacancyId,
        employeeId,
        role,
      },
      update: { role },
      include: { employee: true },
    });
    return serializeAssignee(row);
  });
}

export async function removeVacancyAssignee(organizationId, vacancyId, assigneeId) {
  await assertRecruitmentVacancyInOrg(vacancyId, organizationId);
  const row = await prisma.recruitmentVacancyAssignee.findFirst({
    where: { id: assigneeId, organizationId, vacancyId },
  });
  if (!row) {
    const err = new Error('NOT_FOUND');
    err.code = 'NOT_FOUND';
    err.message = 'Asignación no encontrada.';
    throw err;
  }
  await prisma.recruitmentVacancyAssignee.delete({ where: { id: assigneeId } });
  return { ok: true };
}
