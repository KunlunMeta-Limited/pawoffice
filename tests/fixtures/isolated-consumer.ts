import { mountScene, type SceneAssembly } from '@pawoffice/renderer-pixi'
import { FrameAdapter } from '@pawoffice/animation-frame'
import type { AnimationAdapter } from '@pawoffice/contracts'
import type { Container } from 'pixi.js'
import type { SceneCommand } from '@pawoffice/protocol'
import type { SceneProjection } from '@pawoffice/contracts/projection'
import { createDimetricProjection } from '@pawoffice/renderer-pixi/projection'
export const adapter: AnimationAdapter<Container> = new FrameAdapter()
export const mount = (host: HTMLElement, load: (signal: AbortSignal) => Promise<SceneAssembly>) => mountScene(host, load)
export const projection: SceneProjection = createDimetricProjection()
export const commandId = (command: SceneCommand) => command.commandId
