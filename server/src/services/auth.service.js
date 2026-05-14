import bcrypt from 'bcryptjs';
import { prisma } from '../db/client.js';

export async function authenticateUser(email, password) {
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    include: { organization: true },
  });
  if (!user) {
    const err = new Error('Credenciales inválidas');
    err.code = 'INVALID_CREDENTIALS';
    throw err;
  }
  if (user.organization?.blocked) {
    const err = new Error('La organización está suspendida. Contacta a soporte.');
    err.code = 'ORG_BLOCKED';
    throw err;
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    const err = new Error('Credenciales inválidas');
    err.code = 'INVALID_CREDENTIALS';
    throw err;
  }
  if (user.role === 'master_admin') {
    const err = new Error('Este tipo de cuenta ya no usa el login estándar. Usa el acceso de administrador general.');
    err.code = 'MASTER_LOGIN_DISABLED';
    throw err;
  }
  if ((user.role === 'empresa_admin' || user.role === 'candidato') && user.organizationId) {
    const org = user.organization;
    if (!org?.empresaPortalEnabled) {
      const err = new Error(
        'Tu empresa no está habilitada en la plataforma. El administrador general debe registrar la empresa antes de que puedas acceder.',
      );
      err.code = 'EMPRESA_NOT_PROVISIONED';
      throw err;
    }
  }
  return user;
}

export function toSessionPayload(user) {
  return {
    userId: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    organizationId: user.organizationId,
  };
}

export async function hashPassword(plain) {
  return bcrypt.hash(plain, 12);
}
