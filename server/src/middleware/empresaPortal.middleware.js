import { prisma } from '../db/client.js';

/** Empresa habilitada por el administrador general (portal empresa/candidato). */
export async function requireEmpresaPortal(req, res, next) {
  const oid = req.session.organizationId;
  if (!oid) {
    return res.status(403).json({
      error: 'EMPRESA_NOT_PROVISIONED',
      message: 'Sin organización asignada.',
    });
  }
  const org = await prisma.organization.findUnique({ where: { id: oid } });
  if (!org?.empresaPortalEnabled) {
    return res.status(403).json({
      error: 'EMPRESA_NOT_PROVISIONED',
      message: 'Esta empresa no está habilitada en la plataforma.',
    });
  }
  if (org.blocked) {
    return res.status(403).json({ error: 'ORG_BLOCKED', message: 'La organización está suspendida.' });
  }
  next();
}
