import { esc, fmtDateMx } from './reportUtils.js';

/**
 * Fragmento placeholder para módulos completados sin plantilla dedicada aún.
 */
export function buildGenericModuleFragment(ctx) {
  const { moduleLabel, moduleIcon, attempt } = ctx;
  const submittedAt = fmtDateMx(attempt?.submittedAt);
  const global =
    attempt?.scores && typeof attempt.scores === 'object' && attempt.scores.global != null
      ? `${Number(attempt.scores.global).toFixed(1)}%`
      : null;

  return `
  <section class="module-block module-block--generic">
    <div class="module-hd">
      <span class="module-icon">${esc(moduleIcon || '◈')}</span>
      <div>
        <h2 class="module-title">${esc(moduleLabel)}</h2>
        <p class="module-sub">Módulo completado · Cierre: ${esc(submittedAt)}</p>
      </div>
    </div>
    <div class="generic-body">
      ${
        global
          ? `<p><strong>Resultado global:</strong> ${esc(global)}</p>`
          : '<p class="muted">Resultados registrados. El desglose gráfico detallado para este instrumento se integrará en una próxima versión del motor de reportes.</p>'
      }
    </div>
  </section>`;
}
