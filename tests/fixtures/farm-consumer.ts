import type { Container } from 'pixi.js'
import type { ScenePack } from '@pawoffice/runtime'
import type { ScenePresentationPack, SceneAssembly } from '@pawoffice/renderer-pixi'
import { AnimationRegistry } from '@pawoffice/renderer-pixi'
import { FrameAdapter } from '@pawoffice/animation-frame'
import { createFarmScenePack, createFarmClock } from '@pawoffice/scene-farm'
import { createFarmPresentation } from '@pawoffice/scene-farm/pixi'
import { bindFarmFrames } from '@pawoffice/assets-farm'
import type { CharacterManifest } from '@pawoffice/animation-frame/packSchema'

const clock = createFarmClock(), scene: ScenePack = createFarmScenePack(clock.now)
const pack: ScenePresentationPack = createFarmPresentation('https://example.test/farm/', clock.now)
declare const source: CharacterManifest
const assembly: SceneAssembly = { scene, pack, animations: new AnimationRegistry<Container>().register(new FrameAdapter()),
  resolveAppearance: async () => bindFarmFrames(source, 'https://example.test/frames.json') }
void assembly
