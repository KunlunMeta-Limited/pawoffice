import type { ResultArtifact, ResultDelivery } from '@pawoffice/protocol/office-ui'
import { resultDeliverySchema } from '@pawoffice/protocol/office-ui'

const maxResourceBytes = 8 * 1024 * 1024

/** Reads backend-owned resources without backend API keys or a fallback to the working file. */
export async function readVersionResource(url: string, signal: AbortSignal, limit = maxResourceBytes) {
  const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]), credentials: 'same-origin' })
  if (!response.ok) throw new Error(response.status === 404 ? '该历史版本已不可用。' : `读取版本失败（HTTP ${response.status}）。`)
  if (Number(response.headers.get('content-length')) > limit) throw new Error('文件过大，请通过原始文件入口下载查看。')
  if (!response.body) throw new Error('后端没有返回文件内容。')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) { await reader.cancel(); throw new Error('文件过大，请通过原始文件入口下载查看。') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return bytes
}

export async function readArtifactVersion(artifact: ResultArtifact, signal: AbortSignal) {
  // Nonempty inline content is the exact historical payload, not a path to the current file.
  const bytes = artifact.content ? new TextEncoder().encode(artifact.content)
    : artifact.url ? await readVersionResource(artifact.url, signal) : new Uint8Array()
  if (!artifact.content && !artifact.url) throw new Error('此版本没有可读取的正文或文件地址。')
  if (artifact.sha256) {
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
    if (actual !== artifact.sha256) throw new Error('版本内容校验失败，后端返回的内容与该版本不一致。')
  }
  return bytes
}

export async function readDeliverySnapshot(delivery: ResultDelivery, signal: AbortSignal) {
  if (delivery.result) return delivery
  const bytes = await readVersionResource(delivery.snapshotUrl, signal, 64 * 1024)
  let parsed: ResultDelivery
  try { parsed = resultDeliverySchema.parse(JSON.parse(new TextDecoder().decode(bytes))) }
  catch { throw new Error('历史交付数据格式不正确。') }
  if (!parsed.result || parsed.id !== delivery.id || parsed.sequence !== delivery.sequence || parsed.turnId !== delivery.turnId) throw new Error('后端返回的交付轮次不匹配（含聊天关联），已停止展示。')
  return parsed
}

export function artifactIsText(artifact: ResultArtifact) {
  const mime = artifact.mimeType.toLowerCase().split(';')[0]
  return mime.startsWith('text/') || ['application/json', 'application/javascript', 'application/xml'].includes(mime)
}
