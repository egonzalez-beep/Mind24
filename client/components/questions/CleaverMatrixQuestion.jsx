/** CLEAVER_MATRIX — selección MÁS / MENOS exclusiva */
export default function CleaverMatrixQuestion({ question, moreOptionId, lessOptionId, onChange }) {
  return (
    <table className="w-full text-sm text-white">
      <thead>
        <tr className="text-xs uppercase text-gray-400">
          <th className="text-left py-2">Palabra</th>
          <th className="text-center px-2">MÁS</th>
          <th className="text-center px-2">MENOS</th>
        </tr>
      </thead>
      <tbody>
        {(question.options || []).map((opt) => (
          <tr key={opt.id} className="bg-white/5">
            <td className="py-2 px-3 font-semibold rounded-l-lg">{opt.label}</td>
            <td className="text-center">
              <input
                type="radio"
                name={`more-${question.id}`}
                checked={moreOptionId === opt.id}
                onChange={() => onChange({ moreOptionId: opt.id, lessOptionId })}
              />
            </td>
            <td className="text-center rounded-r-lg">
              <input
                type="radio"
                name={`less-${question.id}`}
                checked={lessOptionId === opt.id}
                onChange={() => onChange({ moreOptionId, lessOptionId: opt.id })}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
