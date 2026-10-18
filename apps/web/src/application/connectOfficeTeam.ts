import type { SceneRuntime } from '@pawoffice/runtime/SceneRuntime'
import { connectSceneRelay } from '@pawoffice/runtime/adapters/sse'
import { sceneRelayUrl } from '../../../shared/scene/connectionConfig.ts'
import type { OfficeTeamTransport } from './OfficeTeamSession.ts'

export function officeTeamTransport(runtime: SceneRuntime, relayUrl = sceneRelayUrl()): OfficeTeamTransport | undefined {
  if (!relayUrl) return undefined
  return onStatus => connectSceneRelay(runtime, relayUrl, onStatus)
}
