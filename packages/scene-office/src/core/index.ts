import type { ScenePack } from '@pawoffice/runtime/scenePack'
import { supportsOfficePose } from './poseSupport.ts'
import { builtinPlugins, createOfficeWorld } from './pack.ts'

export const officeScenePack: ScenePack = {
  manifest: { id: 'pawoffice.office', version: '1.0.0', apiVersion: 1 },
  plugins: builtinPlugins, createWorld: createOfficeWorld,
  supportsPose: supportsOfficePose,
}
export * from './pack.ts'
export { referenceOfficeScenePack, createReferenceOfficeWorld } from './referenceOffice.ts'
export { describeOfficeScene } from './integration.ts'
