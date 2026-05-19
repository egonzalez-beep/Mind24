/**
 * Validación y payload para POST /api/me/attempts/:id/responses
 */

export function isDynamicDraftValid(question, draft = {}) {
  if (!question) return false;
  const d = draft || {};
  switch (question.type) {
    case 'MULTIPLE_CHOICE':
      return Boolean(d.selectedOptionId);
    case 'CLEAVER_MATRIX':
      return (
        Boolean(d.moreOptionId) &&
        Boolean(d.lessOptionId) &&
        d.moreOptionId !== d.lessOptionId
      );
    case 'OPEN_TEXT':
      return Boolean(d.textValue && String(d.textValue).trim());
    case 'AUDIO_RECORDING':
      return Boolean(d.audioUrl);
    default:
      return false;
  }
}

/** @returns {{ questionId: string, ... }} */
export function buildDynamicResponsePayload(question, draft = {}) {
  const body = { questionId: question.id };
  switch (question.type) {
    case 'MULTIPLE_CHOICE':
      body.selectedOptionId = draft.selectedOptionId;
      break;
    case 'CLEAVER_MATRIX':
      body.moreOptionId = draft.moreOptionId;
      body.lessOptionId = draft.lessOptionId;
      break;
    case 'OPEN_TEXT':
      body.textValue = draft.textValue;
      break;
    case 'AUDIO_RECORDING':
      body.audioUrl = draft.audioUrl;
      break;
    default:
      break;
  }
  return body;
}
