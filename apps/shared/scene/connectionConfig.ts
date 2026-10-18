export function sceneRelayUrl(): string | undefined {
  const config = (globalThis as typeof globalThis & { __PAWOFFICE_CONFIG__?: { relayUrl?: string } }).__PAWOFFICE_CONFIG__
  return config?.relayUrl || undefined
}
