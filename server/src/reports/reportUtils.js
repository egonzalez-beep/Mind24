/** Utilidades compartidas para fragmentos y layout de reportes PDF. */

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function shortEvalId(id) {
  const s = String(id || '');
  return s.length > 10 ? s.slice(0, 8).toUpperCase() : s.toUpperCase();
}

export function parseCandidateDisplay(user) {
  const raw = String(user?.fullName || 'Candidato').trim();
  const parts = raw.split('·').map((p) => p.trim());
  if (parts.length >= 2) {
    return { name: parts[0], puesto: parts.slice(1).join(' · ') };
  }
  return { name: raw, puesto: '—' };
}

export function fmtDateMx(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

export function safeFilenamePart(name) {
  return (
    String(name || 'candidato')
      .replace(/[^\w\s-áéíóúñÁÉÍÓÚÑ]/g, '')
      .trim()
      .replace(/\s+/g, '_') || 'candidato'
  );
}
