/** Código corto de 5 dígitos derivado del id de asignación (mismo algoritmo que el frontend). */
export function mind24ShortAssignmentCode(assignmentId) {
  const s = String(assignmentId || '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return String(Math.abs(h >>> 0) % 100000).padStart(5, '0');
}

export function normalizeAccessCodeInput(raw) {
  return String(raw || '')
    .trim()
    .replace(/\s/g, '');
}
