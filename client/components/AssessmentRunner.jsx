import MultipleChoiceQuestion from './questions/MultipleChoiceQuestion.jsx';
import CleaverMatrixQuestion from './questions/CleaverMatrixQuestion.jsx';
import AudioRecordingQuestion from './questions/AudioRecordingQuestion.jsx';
import OpenTextQuestion from './questions/OpenTextQuestion.jsx';
import {
  buildDynamicResponsePayload,
  isDynamicDraftValid,
} from '../utils/dynamicDraft.js';

/**
 * Contenedor del motor dinámico Mind24.
 * Props:
 * - questions: array serializado desde GET /api/me/attempts/:id/engine
 * - currentIndex: índice activo
 * - draft: respuesta en edición del ítem actual
 * - onChange: (partialDraft) => void
 * - onPrev / onNext: navegación (onNext debe persistir con buildDynamicResponsePayload)
 * - isLast: boolean
 */
export default function AssessmentRunner({
  questions = [],
  currentIndex = 0,
  draft = {},
  onChange,
  onPrev,
  onNext,
  isLast = false,
}) {
  const question = questions[currentIndex];
  if (!question) {
    return <p className="text-gray-400">No hay preguntas en este módulo.</p>;
  }

  const canAdvance = isDynamicDraftValid(question, draft);

  const handleChange = (partial) => onChange?.({ ...draft, ...partial });

  let body = null;
  switch (question.type) {
    case 'MULTIPLE_CHOICE':
      body = (
        <MultipleChoiceQuestion
          question={question}
          value={draft.selectedOptionId}
          onChange={(selectedOptionId) => handleChange({ selectedOptionId })}
        />
      );
      break;
    case 'CLEAVER_MATRIX':
      body = (
        <CleaverMatrixQuestion
          question={question}
          moreOptionId={draft.moreOptionId ?? null}
          lessOptionId={draft.lessOptionId ?? null}
          onChange={handleChange}
        />
      );
      break;
    case 'AUDIO_RECORDING':
      body = (
        <AudioRecordingQuestion
          question={question}
          audioUrl={draft.audioUrl}
          onChange={(audioUrl) => handleChange({ audioUrl })}
        />
      );
      break;
    case 'OPEN_TEXT':
      body = (
        <OpenTextQuestion
          question={question}
          value={draft.textValue || ''}
          onChange={(textValue) => handleChange({ textValue })}
        />
      );
      break;
    default:
      body = <p>Tipo de pregunta no soportado: {question.type}</p>;
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto p-4">
      <header>
        <p className="text-xs uppercase tracking-widest text-violet-300/80">
          Pregunta {currentIndex + 1} de {questions.length}
        </p>
        <h2 className="text-lg font-semibold text-white mt-1">{question.text}</h2>
      </header>
      {body}
      <footer className="flex flex-col gap-3 pt-4 border-t border-white/10">
        <p className="text-center text-xs text-white/45">
          {canAdvance ? '✓ Listo para continuar' : 'Responde para continuar'}
        </p>
        <div className="flex justify-between items-center gap-4">
          <button
            type="button"
            onClick={onPrev}
            disabled={currentIndex === 0}
            className="px-4 py-2 rounded-lg border border-white/20 text-white/80 disabled:opacity-40 transition hover:bg-white/5"
          >
            ← Anterior
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={!canAdvance}
            className="px-5 py-2 rounded-lg bg-violet-600 text-white font-bold disabled:opacity-40 disabled:cursor-not-allowed transition hover:bg-violet-500"
          >
            {isLast ? 'Finalizar ✓' : 'Siguiente →'}
          </button>
        </div>
      </footer>
    </div>
  );
}

export { buildDynamicResponsePayload, isDynamicDraftValid };
