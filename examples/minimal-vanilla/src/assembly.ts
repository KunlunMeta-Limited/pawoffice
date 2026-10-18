import { AnimationRegistry, createAppearanceResolver } from '@pawoffice/renderer-pixi'
import type { SceneAssembly } from '@pawoffice/renderer-pixi'
import { FrameAdapter } from '@pawoffice/animation-frame'
import { characterAssets } from '@pawoffice/assets-office/frame/resources'
import { officeScenePack } from '@pawoffice/scene-office'
import { createOfficePresentation, configureOfficeAssets } from '@pawoffice/scene-office/pixi'
import type { Container } from 'pixi.js'

export function createAssembly(signal: AbortSignal): SceneAssembly {
  configureOfficeAssets({ baseUrl: `${import.meta.env.BASE_URL}assets/office` })
  return { product: { id: 'pawoffice.classic', storageNamespace: 'classic', presentationProfileId: 'office-character-v1' }, scene: officeScenePack, pack: createOfficePresentation(),
    animations: new AnimationRegistry<Container>().register(new FrameAdapter(manifest => characterAssets.acquire(manifest.asset.id, manifest.source.uri))),
    resolveAppearance: createAppearanceResolver(id => new URL(`${import.meta.env.BASE_URL}characters/visuals/${encodeURIComponent(id)}.json`, document.baseURI).href, signal),
  }
}
