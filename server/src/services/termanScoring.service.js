import { TERMAN_SERIES } from '../data/termanData.js';

/**
 * Califica intento Terman comparando opción seleccionada vs índice correcto en metadata.
 * @param {Array<{ questionId: string, selectedOptionId: string|null, question: object, selectedOption: object|null }>} rows
 */
export function scoreTermanResponses(rows) {
  const seriesMap = {};
  for (const s of TERMAN_SERIES) {
    seriesMap[s.seriesId] = {
      seriesId: s.seriesId,
      name: s.name,
      correct: 0,
      total: s.questions.length,
      timedOut: false,
    };
  }

  let rawScore = 0;
  let totalQuestions = 0;

  for (const row of rows) {
    const meta = row.question?.metadata;
    if (!meta || typeof meta !== 'object') continue;
    const seriesId = meta.seriesId;
    if (!seriesMap[seriesId]) continue;

    totalQuestions += 1;
    const correctIndex = Number(meta.correctIndex);
    const selectedSort = row.selectedOption?.sortOrder;
    const isCorrect =
      row.selectedOptionId &&
      Number.isFinite(correctIndex) &&
      Number.isFinite(selectedSort) &&
      selectedSort === correctIndex;

    if (isCorrect) {
      rawScore += 1;
      seriesMap[seriesId].correct += 1;
    }
  }

  // Totales esperados del banco activo
  const expectedTotal = TERMAN_SERIES.reduce((n, s) => n + s.questions.length, 0);
  if (totalQuestions < expectedTotal) {
    totalQuestions = expectedTotal;
  }

  const series = TERMAN_SERIES.map((s) => {
    const entry = seriesMap[s.seriesId];
    const total = entry.total || s.questions.length;
    const correct = entry.correct || 0;
    const percent = total > 0 ? Math.round((correct / total) * 1000) / 10 : 0;
    return {
      seriesId: s.seriesId,
      name: s.name,
      correct,
      total,
      percent,
    };
  });

  const percentCorrect =
    totalQuestions > 0 ? Math.round((rawScore / totalQuestions) * 1000) / 10 : 0;

  /** Placeholder CI — calibración oficial en sprint siguiente. */
  const ciEstimate = Math.round(70 + (percentCorrect / 100) * 60);
  const iqEstimate = ciEstimate;

  return {
    rawScore,
    totalQuestions,
    percentCorrect,
    ci: null,
    iq: null,
    ciEstimate,
    iqEstimate,
    ciNote: 'Coeficiente intelectual sujeto a tabla de baremos oficial (próxima calibración).',
    series,
  };
}

export function buildTermanAttemptScores(scoring) {
  return {
    instrument: 'terman',
    scores: {
      rawScore: scoring.rawScore,
      totalQuestions: scoring.totalQuestions,
      percentCorrect: scoring.percentCorrect,
      ci: scoring.ci,
      iq: scoring.iq,
      ciEstimate: scoring.ciEstimate,
      iqEstimate: scoring.iqEstimate,
      ciNote: scoring.ciNote,
      series: scoring.series,
    },
    meta: {
      scoredAt: new Date().toISOString(),
      engine: 'terman',
    },
  };
}
