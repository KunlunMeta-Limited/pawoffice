import { createSceneRuntime, type SceneReadPort } from '@pawoffice/runtime'
import { officeScenePack } from '@pawoffice/scene-office'
import { createOfficePresentation } from '@pawoffice/scene-office/pixi'
import { FrameAdapter } from '@pawoffice/animation-frame'
import { SceneView, AnimationRegistry } from '@pawoffice/renderer-pixi'
import type { AnimationAdapter, VisualAssetManifest } from '@pawoffice/contracts'
import type { Container } from 'pixi.js'

const runtime = createSceneRuntime(officeScenePack)
const readPort: SceneReadPort = runtime
const adapter: AnimationAdapter<Container> = new FrameAdapter()
export function assemble(resolveAppearance: (id: string) => Promise<VisualAssetManifest>) {
  return new SceneView({ runtime: readPort, pack: createOfficePresentation(), resolveAppearance,
    animations: new AnimationRegistry<Container>().register(adapter),
    onStep: elapsed => runtime.tick(elapsed), dispatchCommand: command => runtime.submit(command) })
}
