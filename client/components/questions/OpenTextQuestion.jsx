/** OPEN_TEXT — respuesta abierta */
export default function OpenTextQuestion({ question, value, onChange }) {
  const placeholder = question.metadata?.placeholder || 'Escribe tu respuesta…';
  const maxLength = question.metadata?.maxLength || 2000;
  return (
    <textarea
      className="w-full min-h-[120px] p-4 rounded-xl border border-white/20 bg-black/30 text-white text-sm leading-tight resize-y"
      placeholder={placeholder}
      maxLength={maxLength}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
