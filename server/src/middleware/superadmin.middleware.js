/** Sesión autenticada + rol `master_admin` (rutas /api/superadmin/*). */
export function requireMasterAdmin(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Se requiere sesión.' });
  }
  if (req.session.role !== 'master_admin') {
    return res.status(403).json({
      error: 'MASTER_ADMIN_REQUIRED',
      message: 'Solo el administrador de plataforma puede realizar esta acción.',
    });
  }
  next();
}
