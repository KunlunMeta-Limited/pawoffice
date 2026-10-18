import { createSceneRuntime } from '@pawoffice/runtime/createSceneRuntime'
import type { CreateSceneRuntimeOptions } from '@pawoffice/runtime/createSceneRuntime'
import { officeScenePack, referenceOfficeScenePack } from '@pawoffice/scene-office/core'

export function createOfficeRuntime({ referenceLayout = false, ...options }: CreateSceneRuntimeOptions & { referenceLayout?: boolean } = {}) {
  return createSceneRuntime(referenceLayout ? referenceOfficeScenePack : officeScenePack, options)
}
