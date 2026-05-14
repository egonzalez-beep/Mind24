export function requireSuperAdmin(req, res, next) {
  if (!req.session?.superAdmin) {
    return res.status(403).json({
      error: 'SUPERADMIN_REQUIRED',
      message: 'Solo el administrador general puede realizar esta acción.',
    });
  }
  next();
}
