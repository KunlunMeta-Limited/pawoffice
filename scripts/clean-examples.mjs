import { readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const outputs = {
  'minimal-vanilla': ['dist'],
  'isolated-scene': ['dist', 'public'],
  classroom: ['dist', 'public'],
  farm: ['dist', 'public'],
  dimetric: ['dist', 'public'],
}
async function size(directory) {
  let entries
  try { entries = await readdir(directory, { withFileTypes: true }) }
  catch (error) { if (error.code === 'ENOENT') return 0; throw error }
  let bytes = 0
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    const target = path.join(directory, entry.name)
    bytes += entry.isDirectory() ? await size(target) : (await stat(target)).size
  }
  return bytes
}

let removedBytes = 0
for (const [name, directories] of Object.entries(outputs)) {
  for (const directory of [...directories, 'node_modules/.vite', 'node_modules/.vite-temp']) {
    const target = path.join(root, 'examples', name, directory)
    removedBytes += await size(target)
    await rm(target, { recursive: true, force: true })
  }
}
console.log(`Removed ${(removedBytes / 1048576).toFixed(2)} MiB of generated example outputs and caches.`)
