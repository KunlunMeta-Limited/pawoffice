import type { OfficeResult, ResultVersion } from '@pawoffice/protocol/office-ui'
import './ResultVersionTimeline.css'

const versionStatusLabels: Record<ResultVersion['status'], string> = {
  draft: '草稿', released: '已发布', 'rolled-back': '已回滚',
}

/**
 * Time language: one vertical node per result revision. The node shape carries the state
 * (released solid / draft hollow / rolled-back red) and the state text always repeats it.
 * The current delivery picker stays a separate top-level control; this is only the record.
 */
export function ResultVersionTimeline({ result }: { result: OfficeResult }) {
  if (!result.versions.length) return null
  return <ol className="result-workspace-versions" data-count={result.versions.length} aria-label="成果版本记录">
    {result.versions.map(version => {
      const meta = [version.author, version.at].filter(Boolean).join(' · ')
      return <li className="result-workspace-version" data-status={version.status} key={version.id}>
        <span className="result-workspace-version-tag" title={`版本 ${version.version}`}>{version.version}</span>
        <span className="result-workspace-version-main">
          {version.note && <p>{version.note}</p>}
          {meta && <span className="result-workspace-version-meta">{meta}</span>}
        </span>
        <span className="result-workspace-version-state" data-status={version.status}>
          {versionStatusLabels[version.status]}
        </span>
      </li>
    })}
  </ol>
}
