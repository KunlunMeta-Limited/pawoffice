type StageState = 'done' | 'active' | 'pending'
type ChipTone = 'done' | 'active' | 'progress' | 'pending' | 'danger'

export function Chip({ tone, children }: { tone: ChipTone; children: string }) {
  return <span className="result-workspace-chip" data-tone={tone}>{children}</span>
}

/** Compact progress track shared by the stage stepper, tests and tasks. */
export function Track({ value, label, tone = 'done', unknown = false }: {
  value: number; label: string; tone?: StageState | 'danger'; unknown?: boolean
}) {
  const percent = Math.max(0, Math.min(100, Math.round(value)))
  return <div className="result-workspace-track" data-tone={tone} data-unknown={unknown ? true : undefined}
    role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100}
    aria-valuenow={unknown ? undefined : percent} aria-valuetext={unknown ? '暂无进度' : `${percent}%`}>
    <i style={{ width: unknown ? '0%' : `${percent}%` }} />
  </div>
}
