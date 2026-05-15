import bcrypt from 'bcryptjs';
import { prisma } from '../db/client.js';
import { hashPassword } from './auth.service.js';
import { defaultDemoAssessmentConfig } from '../assessment/defaultDefinition.js';
import { env } from '../config/env.js';

/** Slug reservado para la org demo de bootstrap. */
const BOOTSTRAP_ORG_SLUG = 'mind24-bootstrap-demo';

const DEF_KEY = 'honestidad_confianza';
const DEF_VERSION = 1;

function nonempty(s) {
  return typeof s === 'string' && s.trim().length > 0;
}

/**
 * Idempotente: sincroniza el `master_admin` de plataforma desde env y/o usuarios demo si todas las vars demo están definidas.
 * No borra organizaciones ni datos; el correo `PLATFORM_ADMIN_EMAIL` puede actualizarse rol/contraseña según env.
 */
export async function runBootstrapUsers() {
  await ensurePlatformMasterAdmin();

  const adminEmailRaw = env.BOOTSTRAP_DEMO_ADMIN_EMAIL;
  const candEmailRaw = env.BOOTSTRAP_DEMO_CANDIDATE_EMAIL;
  const adminPass = env.BOOTSTRAP_DEMO_ADMIN_PASSWORD;
  const candPass = env.BOOTSTRAP_DEMO_CANDIDATE_PASSWORD;

  const demoReady =
    nonempty(adminEmailRaw) &&
    nonempty(candEmailRaw) &&
    nonempty(adminPass) &&
    nonempty(candPass);

  if (!demoReady) {
    console.log(
      '[bootstrap] Demo org/users skipped: set BOOTSTRAP_DEMO_ADMIN_EMAIL, BOOTSTRAP_DEMO_ADMIN_PASSWORD, BOOTSTRAP_DEMO_CANDIDATE_EMAIL, BOOTSTRAP_DEMO_CANDIDATE_PASSWORD to enable.',
    );
    return;
  }

  const adminEmail = adminEmailRaw.trim().toLowerCase();
  const candEmail = candEmailRaw.trim().toLowerCase();

  const admin = await prisma.user.findUnique({ where: { email: adminEmail } });
  const candUser = await prisma.user.findUnique({ where: { email: candEmail } });

  if (admin && candUser) {
    const { def: definition } = await findOrCreateDefinition();
    await ensureCandidateProfileAndAssignment(admin, candUser, definition.id);
    console.log('Bootstrap users already exist');
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
        passwordHash: await hashPassword(adminPass.trim()),
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
        passwordHash: await hashPassword(candPass.trim()),
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
}

async function ensurePlatformMasterAdmin() {
  const em = (env.PLATFORM_ADMIN_EMAIL || '').trim().toLowerCase();
  if (!em) {
    console.warn('[bootstrap] Skip platform master_admin: PLATFORM_ADMIN_EMAIL not set.');
    return;
  }

  const rawPw = env.PLATFORM_ADMIN_PASSWORD;
  const hasPassword = nonempty(rawPw);
  const trimmedPw = hasPassword ? String(rawPw).trim() : '';

  const existing = await prisma.user.findUnique({ where: { email: em } });

  if (!existing) {
    if (!hasPassword) {
      console.log(
        '[bootstrap] Skip platform master_admin: user does not exist and PLATFORM_ADMIN_PASSWORD not set.',
      );
      return;
    }
    await prisma.user.create({
      data: {
        email: em,
        passwordHash: await hashPassword(trimmedPw),
        fullName: 'Administrador plataforma',
        role: 'master_admin',
        organizationId: null,
      },
    });
    console.log('[bootstrap] created platform admin');
    return;
  }

  const data = {};
  let needsRoleOrOrgFix = false;

  if (existing.role !== 'master_admin') {
    data.role = 'master_admin';
    needsRoleOrOrgFix = true;
  }
  if (existing.organizationId != null) {
    data.organizationId = null;
    needsRoleOrOrgFix = true;
  }

  if (hasPassword) {
    const pwdMatches = await bcrypt.compare(trimmedPw, existing.passwordHash);
    if (!pwdMatches) {
      data.passwordHash = await hashPassword(trimmedPw);
    }
  }

  if (Object.keys(data).length === 0) {
    console.log('[bootstrap] platform admin already valid');
    return;
  }

  await prisma.user.update({ where: { id: existing.id }, data });

  if (needsRoleOrOrgFix) {
    console.log('[bootstrap] upgraded user to master_admin');
  }
  if (data.passwordHash) {
    console.log('[bootstrap] updated platform admin password');
  }
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
