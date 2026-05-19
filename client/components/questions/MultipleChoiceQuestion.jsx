/** MULTIPLE_CHOICE — opción única */
export default function MultipleChoiceQuestion({ question, value, onChange }) {
  return (
    <ul className="flex flex-col gap-2">
      {(question.options || []).map((opt) => (
        <li key={opt.id}>
          <label
            className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition ${
              value === opt.id
                ? 'border-violet-400 bg-violet-500/20'
                : 'border-white/10 bg-white/5 hover:bg-white/10'
            }`}
          >
            <input
              type="radio"
              name={`mc-${question.id}`}
              checked={value === opt.id}
              onChange={() => onChange(opt.id)}
              className="mt-1 accent-violet-400"
            />
            <span className="text-white text-sm leading-tight">{opt.label}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}
