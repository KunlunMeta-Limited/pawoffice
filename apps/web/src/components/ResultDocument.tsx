import { useMemo } from 'react'
import type { OutputBoard } from '@pawoffice/protocol/office-ui'

const policy = "default-src 'none'; script-src 'unsafe-inline' https: http:; style-src 'unsafe-inline' https: http:; img-src data: blob: https: http:; font-src data: https: http:; connect-src https: http:; media-src https: http:; frame-src https: http:; base-uri 'none'; form-action 'none'"

/** Report code has its own origin and cannot access the office page or its storage. */
export function ResultDocument({ board }: { board?: OutputBoard }) {
  const source = board?.detail
  const html = source?.format === 'html' ? source.html : ''
  const srcDoc = useMemo(() => `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;font-family:system-ui,sans-serif}*{box-sizing:border-box}</style></head><body>${html}</body></html>`, [html])
  if (!source) return <p className="whiteboard-result-empty">{board ? '暂未提供结果详情' : '等待结果更新'}</p>
  return <iframe className="whiteboard-result-document" title="结果白板详情" sandbox="allow-scripts" referrerPolicy="no-referrer"
    src={source.format === 'url' ? source.url : undefined} srcDoc={source.format === 'html' ? srcDoc : undefined} />
}
