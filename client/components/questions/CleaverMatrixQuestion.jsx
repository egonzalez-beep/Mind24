/**
 * CLEAVER_MATRIX — matriz MÁS (+) / MENOS (-) por bloque de 4 palabras.
 * Estado controlado: moreOptionId, lessOptionId (IDs de QuestionOption).
 */

function CleaverPick({ checked, disabled, onSelect, ariaLabel }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onSelect}
      className={[
        'group relative flex h-9 w-9 items-center justify-center rounded-full border-2 transition-all duration-200',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent',
        disabled
          ? 'cursor-not-allowed border-white/10 opacity-30'
          : checked
            ? 'border-violet-300 bg-violet-500/35 shadow-[0_0_0_3px_rgba(124,58,237,0.25)]'
            : 'border-white/25 bg-white/5 hover:border-violet-300/70 hover:bg-violet-500/15',
      ].join(' ')}
    >
      <span
        className={[
          'h-2.5 w-2.5 rounded-full bg-white transition-transform duration-200',
          checked ? 'scale-100 opacity-100' : 'scale-0 opacity-0',
        ].join(' ')}
      />
    </button>
  );
}

export default function CleaverMatrixQuestion({
  question,
  moreOptionId = null,
  lessOptionId = null,
  onChange,
}) {
  const options = question?.options ?? [];
  const instruction =
    question?.metadata?.instruction ||
    'Elige una palabra distinta en MÁS y en MENOS. No puedes usar la misma en ambas columnas.';

  const pickMore = (optionId) => {
    onChange?.({
      moreOptionId: optionId,
      lessOptionId: lessOptionId === optionId ? null : lessOptionId,
    });
  };

  const pickLess = (optionId) => {
    if (moreOptionId === optionId) return;
    onChange?.({ moreOptionId, lessOptionId: optionId });
  };

  const isValid =
    Boolean(moreOptionId) &&
    Boolean(lessOptionId) &&
    moreOptionId !== lessOptionId;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs leading-relaxed text-white/55">{instruction}</p>

      <div
        className="overflow-hidden rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm"
        role="group"
        aria-label="Matriz Cleaver"
      >
        <div className="grid grid-cols-[1fr_4.5rem_4.5rem] items-center border-b border-white/10 bg-white/[0.03] px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-white/45 sm:px-4">
          <div aria-hidden="true" />
          <div className="text-center text-violet-200/90">MÁS (+)</div>
          <div className="text-center text-rose-200/80">MENOS (-)</div>
        </div>

        {options.map((opt, index) => {
          const moreOn = moreOptionId === opt.id;
          const lessOn = lessOptionId === opt.id;
          const lessDisabled = moreOptionId === opt.id;
          const moreDisabled = lessOptionId === opt.id;

          return (
            <div
              key={opt.id}
              className={[
                'grid grid-cols-[1fr_4.5rem_4.5rem] items-center px-3 py-1 sm:px-4',
                index < options.length - 1 ? 'border-b border-white/5' : '',
                moreOn || lessOn ? 'bg-violet-500/[0.07]' : 'hover:bg-white/[0.03]',
              ].join(' ')}
            >
              <div className="py-3 pr-2 text-sm font-semibold leading-snug text-white sm:text-[15px]">
                {opt.label}
              </div>

              <div className="flex justify-center py-2">
                <CleaverPick
                  checked={moreOn}
                  disabled={moreDisabled}
                  ariaLabel={`MÁS: ${opt.label}`}
                  onSelect={() => pickMore(opt.id)}
                />
              </div>

              <div className="flex justify-center py-2">
                <CleaverPick
                  checked={lessOn}
                  disabled={lessDisabled}
                  ariaLabel={`MENOS: ${opt.label}`}
                  onSelect={() => pickLess(opt.id)}
                />
              </div>
            </div>
          );
        })}
      </div>

      <p
        className={[
          'text-xs font-medium transition-colors',
          isValid ? 'text-emerald-300/90' : 'text-white/40',
        ].join(' ')}
        aria-live="polite"
      >
        {isValid
          ? '✓ Selección completa. Puedes continuar.'
          : 'Selecciona una palabra en MÁS y otra distinta en MENOS.'}
      </p>
    </div>
  );
}
