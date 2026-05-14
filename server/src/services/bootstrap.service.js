import { prisma } from '../db/client.js';
import { hashPassword } from './auth.service.js';
import { defaultDemoAssessmentConfig } from '../assessment/defaultDefinition.js';

/** Slug reservado para la org demo de bootstrap. */
const BOOTSTRAP_ORG_SLUG = 'mind24-bootstrap-demo';

const DEMO_ADMIN_EMAIL = 'admin@demo.mind24.com';
const DEMO_CANDIDATE_EMAIL = 'candidato@demo.mind24.com';
const DEMO_ADMIN_PASSWORD = 'Admin123';
const DEMO_CANDIDATE_PASSWORD = 'Candidato123';

const DEF_KEY = 'honestidad_confianza';
const DEF_VERSION = 1;

/**
 * Idempotente: solo crea admin/candidato/org/definición/asignación si faltan.
 * No borra datos, no resetea contraseñas, no duplica emails.
 * Superadmin del panel general NO usa tabla User (solo env + POST /api/superadmin/login).
 */
export async function runBootstrapUsers() {
  const adminEmail = DEMO_ADMIN_EMAIL.trim().toLowerCase();
  const candEmail = DEMO_CANDIDATE_EMAIL.trim().toLowerCase();

  const admin = await prisma.user.findUnique({ where: { email: adminEmail } });
  const candUser = await prisma.user.findUnique({ where: { email: candEmail } });

  if (admin && candUser) {
    const { def: definition } = await findOrCreateDefinition();
    await ensureCandidateProfileAndAssignment(admin, candUser, definition.id);
    console.log('Bootstrap users already exist');
    logSuperadminHint();
    return;
  }

  let created = false;

  let org = null;
  if (admin?.organizationId) {
    org = await prisma.organization.findUnique({ where: { id: admin.organizationId } });
  } else if (candUser?.organizationId) {
    org = await prisma.organization.findUnique({ where: { id: candUser.organizationId } });
  }
  if (!org) {
    org = await prisma.organization.findUnique({ where: { slug: BOOTSTRAP_ORG_SLUG } });
  }
  if (!org) {
    org = await prisma.organization.create({
      data: {
        name: 'Empresa Demo',
        slug: BOOTSTRAP_ORG_SLUG,
        credits: 500,
        blocked: false,
        empresaPortalEnabled: true,
      },
    });
    created = true;
  } else if (!org.empresaPortalEnabled) {
    await prisma.organization.update({
      where: { id: org.id },
      data: { empresaPortalEnabled: true },
    });
  }

  const { def: definition, created: defCreated } = await findOrCreateDefinition();
  if (defCreated) created = true;

  let adminRow = admin;
  if (!adminRow) {
    adminRow = await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash: await hashPassword(DEMO_ADMIN_PASSWORD),
        fullName: 'Admin Demo',
        role: 'empresa_admin',
        organizationId: org.id,
      },
    });
    created = true;
  }

  let candRow = candUser;
  if (!candRow) {
    candRow = await prisma.user.create({
      data: {
        email: candEmail,
        passwordHash: await hashPassword(DEMO_CANDIDATE_PASSWORD),
        fullName: 'Candidato Demo',
        role: 'candidato',
        organizationId: org.id,
      },
    });
    created = true;
  }

  await ensureCandidateProfileAndAssignment(adminRow, candRow, definition.id);

  if (created) {
    console.log('Bootstrap users created');
  } else {
    console.log('Bootstrap users already exist');
  }
  logSuperadminHint();
}

async function findOrCreateDefinition() {
  let def = await prisma.assessmentDefinition.findFirst({
    where: { key: DEF_KEY, version: DEF_VERSION },
  });
  if (def) return { def, created: false };
  def = await prisma.assessmentDefinition.create({
    data: {
      key: DEF_KEY,
      name: 'Batería de Honestidad y Confianza',
      version: DEF_VERSION,
      organizationId: null,
      config: defaultDemoAssessmentConfig,
      isActive: true,
    },
  });
  return { def, created: true };
}

async function ensureCandidateProfileAndAssignment(admin, candUser, definitionId) {
  let candidate = await prisma.candidate.findUnique({ where: { userId: candUser.id } });
  if (!candidate) {
    candidate = await prisma.candidate.create({
      data: {
        organizationId: candUser.organizationId,
        userId: candUser.id,
      },
    });
  }

  const existing = await prisma.assignment.findFirst({
    where: {
      candidateId: candidate.id,
      assessmentDefinitionId: definitionId,
    },
  });
  if (!existing) {
    await prisma.assignment.create({
      data: {
        candidateId: candidate.id,
        assessmentDefinitionId: definitionId,
        assignedByUserId: admin.id,
        status: 'pending',
      },
    });
  }
}

function logSuperadminHint() {
  console.log(
    '[bootstrap] Superadmin (panel general): credenciales por SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD_HASH; login POST /api/superadmin/login (sin fila User).',
  );
}
