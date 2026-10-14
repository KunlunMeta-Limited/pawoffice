import '@esotericsoftware/spine-pixi-v8'
import { Assets } from 'pixi.js'

/** AI 办公室小人动画资源包 */
export type SpineCharacterPack = 'chibi-stickers'

let loaded = false
let loadPromise: Promise<boolean> | null = null
let activePack: SpineCharacterPack | null = null
let skeletonAlias = ''
let atlasAlias = ''

const PACKS: { id: SpineCharacterPack; skeleton: string; atlas: string }[] = [
  {
    id: 'chibi-stickers',
    skeleton: '/assets/characters/chibi-stickers/chibi-stickers.json',
    atlas: '/assets/characters/chibi-stickers/chibi-stickers.atlas',
  },
]

async function loadSpineAssetsOnce(): Promise<boolean> {
  for (const pack of PACKS) {
    const sk = `${pack.id}-skeleton`
    const at = `${pack.id}-atlas`
    try {
      if (!Assets.resolver.hasKey(sk)) Assets.add({ alias: sk, src: pack.skeleton })
      if (!Assets.resolver.hasKey(at)) Assets.add({ alias: at, src: pack.atlas })
      await Assets.load([sk, at])
      skeletonAlias = sk
      atlasAlias = at
      activePack = pack.id
      loaded = true
      console.info(`[Spine] 高质量角色包已加载: ${pack.id}`)
      return true
    } catch (err) {
      console.warn(`[Spine] 资源包 "${pack.id}" 加载失败:`, err)
    }
  }

  console.error('[Spine] 角色资源加载失败，将使用程序绘制')
  return false
}

/** 多个完整办公室并发初始化时共享同一资源注册与加载任务。 */
export async function loadSpineAssets(): Promise<boolean> {
  if (loaded) return true
  loadPromise ??= loadSpineAssetsOnce()
  const result = await loadPromise
  if (!result) loadPromise = null
  return result
}

export function isSpineReady(): boolean {
  return loaded
}

export function getSpineCharacterPack(): SpineCharacterPack | null {
  return activePack
}

export function getSpineSkeletonAlias(): string {
  return skeletonAlias
}

export function getSpineAtlasAlias(): string {
  return atlasAlias
}
