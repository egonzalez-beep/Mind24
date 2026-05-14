import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { defaultDemoAssessmentConfig } from '../src/assessment/defaultDefinition.js';

const prisma = new PrismaClient();

async function main() {
  const hash = (p) => bcrypt.hash(p, 12);

  await prisma.assessmentAttempt.deleteMany();
  await prisma.assignment.deleteMany();
  await prisma.candidate.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();
  await prisma.assessmentDefinition.deleteMany();

  const org = await prisma.organization.create({
    data: { name: 'Empresa Demo', slug: 'demo', credits: 500, blocked: false },
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

  const master = await prisma.user.create({
    data: {
      email: 'master@mind24.local',
      passwordHash: await hash('ChangeMeMaster123!'),
      fullName: 'Master Admin',
      role: 'master_admin',
      organizationId: null,
    },
  });

  const empresa = await prisma.user.create({
    data: {
      email: 'admin@demo.mind24.local',
      passwordHash: await hash('ChangeMeAdmin123!'),
      fullName: 'Admin Demo',
      role: 'empresa_admin',
      organizationId: org.id,
    },
  });

  const candUser = await prisma.user.create({
    data: {
      email: 'candidato@demo.mind24.local',
      passwordHash: await hash('ChangeMeCandidato123!'),
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

  console.log('Seed OK:', { master: master.email, empresa: empresa.email, candidato: candUser.email });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
