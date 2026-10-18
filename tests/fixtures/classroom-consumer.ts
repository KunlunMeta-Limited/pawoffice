import type { Container } from 'pixi.js'
import type { ScenePack } from '@pawoffice/runtime'
import type { ScenePresentationPack, SceneAssembly } from '@pawoffice/renderer-pixi'
import { AnimationRegistry } from '@pawoffice/renderer-pixi'
import { FrameAdapter } from '@pawoffice/animation-frame'
import { classroomScenePack } from '@pawoffice/scene-classroom'
import { createClassroomPresentation } from '@pawoffice/scene-classroom/pixi'
import { bindClassroomFrames } from '@pawoffice/assets-classroom'
import type { CharacterManifest } from '@pawoffice/animation-frame/packSchema'

const scene: ScenePack = classroomScenePack
const pack: ScenePresentationPack = createClassroomPresentation('https://example.test/classroom/')
declare const source: CharacterManifest
const assembly: SceneAssembly = { scene, pack, animations: new AnimationRegistry<Container>().register(new FrameAdapter()),
  resolveAppearance: async () => bindClassroomFrames(source, 'https://example.test/frames.json') }
void assembly
