import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { readAssetCatalogFiles } from './export-pack.mjs'

const shared = ['LICENSE.txt', 'THIRD_PARTY_NOTICES.txt', 'pawoffice-config.js']
const shellAssets = ['brand/logo.png', 'brand/title.png', 'brand/icon.png', 'assets/office/preview.webp', 'assets/office/empty-office.webp']

/** Publish current catalog entries, never the contents of an old generated directory. */
export async function collectReleaseAssets(directory, product = 'app') {
  if (!['app', 'office', 'classroom', 'farm'].includes(product)) throw new Error(`Unknown release product: ${product}`)
  const root = await realpath(directory), files = new Map()
  const add = async file => {
    const target = await realpath(path.join(root, file))
    if (!target.startsWith(root + path.sep)) throw new Error(`Asset escapes root: ${file}`)
    files.set(file, await readFile(target))
  }
  const catalog = async (file, prefix = '') => {
    await add(file)
    const entries = await readAssetCatalogFiles(path.join(root, prefix), JSON.parse(files.get(file)))
    for (const [name, buffer] of entries) files.set(path.posix.join(prefix, name), buffer)
    return entries
  }
  for (const file of product === 'app' || product === 'office' ? shared : ['pawoffice-config.js']) await add(file)
  if (product === 'app' || product === 'office') {
    for (const file of shellAssets) await add(file)
    const office = await catalog('asset-packs/office-complete.json')
    await catalog('asset-packs/office-furniture.json')
    const registry = JSON.parse(office.get('characters/registry.json'))
    for (const character of registry.characters) await catalog(`asset-packs/${character.id}.json`)
  }
  for (const scene of product === 'app' ? ['classroom', 'farm'] : ['classroom', 'farm'].filter(scene => scene === product)) {
    await catalog(`${scene}-assets/asset-pack.json`, `${scene}-assets`)
  }
  return files
}

export function releaseAssetsPlugin(product = 'app') {
  let publicDir
  return {
    name: 'current-release-assets', apply: 'build',
    config: () => ({ build: { copyPublicDir: false } }),
    configResolved(config) { publicDir = config.publicDir },
    async generateBundle() {
      for (const [fileName, source] of await collectReleaseAssets(publicDir, product)) this.emitFile({ type: 'asset', fileName, source })
    },
  }
}
