import type { DiffLine } from '../results/diff.ts'

export function ResultDiffTable({ lines, label }: { lines: DiffLine[]; label: string }) {
  return <div className="result-diff-scroll" role="region" aria-label="逐行差异，可横向与纵向滚动" tabIndex={0}>
    <table className="result-diff-table" aria-label={label}>
      <colgroup><col className="result-diff-number-column" /><col className="result-diff-number-column" /><col className="result-diff-marker-column" /><col /></colgroup>
      <thead><tr><th scope="col">旧行</th><th scope="col">新行</th><th scope="col" aria-label="变更类型" /><th scope="col">代码内容</th></tr></thead>
      <tbody>{lines.map((line, index) => <tr key={index} data-kind={line.kind}>
        <td className="result-diff-line-number">{line.oldLine ?? ''}</td>
        <td className="result-diff-line-number">{line.newLine ?? ''}</td>
        <td className="result-diff-marker">{line.kind === 'added' ? '+' : line.kind === 'deleted' ? '−' : ''}</td>
        <td className="result-diff-code"><code>{line.text || ' '}</code></td>
      </tr>)}</tbody>
    </table>
  </div>
}
