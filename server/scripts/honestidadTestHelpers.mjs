/** Helpers para tests Honestidad — respuestas likert equivalentes post-reorden. */
export function principalQuestions(cfg) {
  return cfg.sections.find((s) => s.id === 'principal')?.questions ?? [];
}

export function bestLikertAnswerIndex(q) {
  const max = Math.max(...q.scoreByIndex);
  return q.scoreByIndex.indexOf(max);
}

export function fillBestLikertAnswers(cfg, answers) {
  for (const q of principalQuestions(cfg)) {
    answers[q.id] = bestLikertAnswerIndex(q);
  }
}
