import type { ResultArtifact } from '@pawoffice/protocol/office-ui'
import { readArtifactVersion } from './resources.ts'

export async function downloadArtifact(artifact: ResultArtifact) {
  const bytes = await readArtifactVersion(artifact, new AbortController().signal)
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: artifact.mimeType }))
  const link = document.createElement('a')
  const extensions: Record<string, string> = { 'text/markdown': '.md', 'text/plain': '.txt', 'application/json': '.json', 'image/png': '.png', 'application/pdf': '.pdf' }
  const title = artifact.title.replace(/[\\/:*?"<>|]/g, '-')
  const dot = title.lastIndexOf('.')
  const suffix = (artifact.version || artifact.versionId).replace(/[\\/:*?"<>|]/g, '-')
  link.download = dot > 0 ? `${title.slice(0, dot)}${suffix ? '-' + suffix : ''}${title.slice(dot)}` : `${title}${suffix ? '-' + suffix : ''}${extensions[artifact.mimeType.split(';')[0]] ?? ''}`
  link.href = url
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
