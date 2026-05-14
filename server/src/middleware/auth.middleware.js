export function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Se requiere sesión.' });
  }
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Se requiere sesión.' });
    }
    if (!roles.includes(req.session.role)) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Permisos insuficientes.' });
    }
    next();
  };
}
