import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { defaultDemoAssessmentConfig } from '../src/assessment/defaultDefinition.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const prisma = new PrismaClient();

function reqEnv(name) {
  const v = process.env[name];
  if (v === undefined || String(v).trim() === '') {
    throw new Error(
      `Missing required env for seed: ${name}. Set SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, SEED_CANDIDATE_EMAIL, SEED_CANDIDATE_PASSWORD (and optional SEED_ORG_SLUG) in server/.env — see server/README.md.`,
    );
  }
  return String(v).trim();
}

async function main() {
  const hash = (p) => bcrypt.hash(p, 12);

  const orgSlug = (process.env.SEED_ORG_SLUG || 'demo').trim() || 'demo';
  const adminEmail = reqEnv('SEED_ADMIN_EMAIL').toLowerCase();
  const adminPassword = reqEnv('SEED_ADMIN_PASSWORD');
  const candEmail = reqEnv('SEED_CANDIDATE_EMAIL').toLowerCase();
  const candPassword = reqEnv('SEED_CANDIDATE_PASSWORD');

  await prisma.assessmentAttempt.deleteMany();
  await prisma.assignment.deleteMany();
  await prisma.candidate.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();
  await prisma.assessmentDefinition.deleteMany();

  const org = await prisma.organization.create({
    data: {
      name: 'Empresa Demo',
      slug: orgSlug,
      credits: 500,
      blocked: false,
      empresaPortalEnabled: true,
    },
  });

  const definition = await prisma.assessmentDefinition.create({
    data: {
      key: 'honestidad_confianza',
      name: 'Batería de Honestidad y Confianza',
      version: 1,
      organizationId: null,
      config: defaultDemoAssessmentConfig,
      isActive: true,
    },
  });

  const empresa = await prisma.user.create({
    data: {
      email: adminEmail,
      passwordHash: await hash(adminPassword),
      fullName: 'Admin Demo',
      role: 'empresa_admin',
      organizationId: org.id,
    },
  });

  const candUser = await prisma.user.create({
    data: {
      email: candEmail,
      passwordHash: await hash(candPassword),
      fullName: 'Candidato Demo',
      role: 'candidato',
      organizationId: org.id,
    },
  });

  const candidate = await prisma.candidate.create({
    data: { organizationId: org.id, userId: candUser.id },
  });

  await prisma.assignment.create({
    data: {
      candidateId: candidate.id,
      assessmentDefinitionId: definition.id,
      assignedByUserId: empresa.id,
      status: 'pending',
    },
  });

  console.log('Seed OK:', { empresa: empresa.email, candidato: candUser.email });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
