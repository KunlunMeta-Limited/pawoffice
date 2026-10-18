import { Container } from 'pixi.js'
import { AnimationRegistry, createAppearanceResolver } from '@pawoffice/renderer-pixi'
import type { SceneAssembly } from '@pawoffice/renderer-pixi'
import { FrameAdapter } from '@pawoffice/animation-frame'
import { classroomScenePack } from '@pawoffice/scene-classroom'
import { createClassroomPresentation } from '@pawoffice/scene-classroom/pixi'
import { classroomAppearanceIds } from '@pawoffice/assets-classroom'

export function createClassroomAssembly(assetBaseUrl: string, signal: AbortSignal): SceneAssembly {
  return {
    product: { id: 'pawoffice.classic', storageNamespace: 'classic', presentationProfileId: 'classroom-character-v1' },
    scene: classroomScenePack, pack: createClassroomPresentation(assetBaseUrl),
    animations: new AnimationRegistry<Container>().register(new FrameAdapter()),
    resolveAppearance: createAppearanceResolver(id => {
      if (!classroomAppearanceIds.some(known => known === id)) throw new Error(`Unknown classroom appearance: ${id}`)
      return new URL(`${id}/visual.json`, assetBaseUrl).href
    }, signal),
  }
}
