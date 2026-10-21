import { readCharacterManifest, characterResourceUrl } from '@pawoffice/assets-office/frame/resources'
import { CharacterManifestSchema, CharacterRegistrySchema } from '@pawoffice/assets-office/frame/packSchema'
import { bindOfficeFrames } from '@pawoffice/assets-office/frame/bindings'
export { bindOfficeFrames }

let coffeeRegistry: Promise<ReturnType<typeof CharacterRegistrySchema.parse>> | undefined
async function json(url: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Office character resource ${url}: HTTP ${response.status}`)
  return response.json()
}
async function readCoffeeManifest(id: string) {
  const registry = await (coffeeRegistry ??= json(characterResourceUrl('coffee-registry.json'))
    .then(value => CharacterRegistrySchema.parse(value)).catch(error => { coffeeRegistry = undefined; throw error }))
  const entry = registry.characters.find(character => character.id === id)
  // Custom appearances retain their original capabilities.
  if (!entry) return readCharacterManifest(id)
  const url = characterResourceUrl(entry.manifest)
  const manifest = CharacterManifestSchema.parse(await json(url))
  if (manifest.id !== id) throw new Error(`Coffee character ID mismatch: ${id}`)
  return { manifest, url }
}

export async function resolveOfficeAppearance(id: string, options: { energeticWork?: boolean; coffeeFrames?: boolean } = {}) {
  const { manifest, url } = await (options.coffeeFrames ? readCoffeeManifest(id) : readCharacterManifest(id))
  const appearance = bindOfficeFrames(manifest, url)
  if (!options.energeticWork) return appearance
  const variantId = 'office.type.seated.back', binding = appearance.source.bindings[variantId]
  if (!binding || !manifest.clips['work.typing-back']) throw new Error(`Missing crafting work frames: ${id}`)
  return { ...appearance, source: { ...appearance.source, bindings: { ...appearance.source.bindings,
    [variantId]: { ...binding, clip: 'work.typing-back' } } } }
}
