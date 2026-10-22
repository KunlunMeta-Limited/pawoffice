import type { ScenePack } from '@pawoffice/runtime/scenePack'
import { supportsOfficePose } from './poseSupport.ts'
import { builtinPlugins, createOfficeWorld } from './pack.ts'

export const officeScenePack: ScenePack = {
  manifest: { id: 'pawoffice.office', version: '1.0.0', apiVersion: 1 },
  plugins: builtinPlugins, createWorld: createOfficeWorld,
  supportsPose: supportsOfficePose,
}
export * from './pack.ts'
export { IDLE_COFFEE, IDLE_RETURN, COFFEE_HOLD, COFFEE_SIP } from './idleCoffee.ts'
export { OfficeIdleCoffee } from './OfficeIdleCoffee.ts'
export { referenceOfficeScenePack, createReferenceOfficeWorld } from './referenceOffice.ts'
export { describeOfficeScene } from './integration.ts'
