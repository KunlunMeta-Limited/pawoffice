import { readFile, mkdir, writeFile, rename } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import sharp from 'sharp'
import { CharacterManifestSchema, CharacterRegistrySchema } from '@pawoffice/assets-office/frame/packSchema'
import { assertCharacterAdmission, compareFrames } from './characters/quality.mjs'
import { alphaBounds } from './assets/build-character.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
export const COFFEE_CHARACTERS = ['office-lead', 'code-agent', 'file-agent', 'app-agent', 'review-agent', 'data-agent']
const sha = data => createHash('sha256').update(data).digest('hex')
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n')

/** A separate, version-bound action selection; never extends the legacy whitelist. */
export async function inspectCoffeeFrames(id, artRoot = path.join(root, 'art/characters')) {
  if (!COFFEE_CHARACTERS.includes(id)) throw new Error(`Unknown coffee character: ${id}`)
  const directory = path.join(artRoot, `${id}-coffee-v1`)
  const animationBytes = await readFile(path.join(directory, 'animation.json'))
  const animation = JSON.parse(animationBytes)
  if (animation.characterId !== id || animation.view !== 'right' || animation.canvas.width !== 256 || animation.canvas.height !== 384
    || animation.pivot.x !== 128 || animation.pivot.y !== 344 || animation.referenceHeight !== 280 || !animation.loop) throw new Error(`${id}: invalid coffee canvas or action metadata`)
  const files = Array.from({ length: 8 }, (_, index) => `frames/right/${String(index + 1).padStart(3, '0')}.png`)
  const registrations = new Map(animation.registrations.map(record => [record.file, record]))
  const scale = registrations.get(files[0])?.scale
  if (!(Number.isFinite(scale) && scale > 0)) throw new Error(`${id}: missing coffee import scale`)
  const inputs = [], hashes = {}, observations = []
  for (const file of files) {
    const registration = registrations.get(file)
    if (!registration || registration.scale !== scale || !Number.isInteger(registration.left) || !Number.isInteger(registration.top)) throw new Error(`${id}/${file}: invalid coffee registration`)
    const bytes = await readFile(path.join(directory, file))
    const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    if (info.width !== 256 || info.height !== 384) throw new Error(`${id}/${file}: invalid frame size`)
    const bounds = alphaBounds(data, 256, 384)
    if (bounds.left === 0 || bounds.top === 0 || bounds.left + bounds.width === 256 || bounds.top + bounds.height === 384) throw new Error(`${id}/${file}: clipped artwork`)
    let foot = 0, top = 384
    for (let y = 0; y < 384; y++) for (let x = 0; x < 256; x++) if (data[(y * 256 + x) * 4 + 3] >= 128) { foot = Math.max(foot, y + 1); top = Math.min(top, y) }
    if (Math.abs(foot - 344) > 2) throw new Error(`${id}/${file}: coffee foot anchor moved`)
    inputs.push({ file, bytes, data, bounds }); hashes[file] = sha(bytes)
    observations.push({ file, foot, top })
  }
  const sequence = animation.frames.map(frame => {
    if (!files.includes(frame.file) || !Number.isInteger(frame.durationMs) || frame.durationMs <= 0) throw new Error(`${id}: invalid coffee timeline`)
    return frame.file
  })
  const expected = [files[0], files[1], files[2], files[3], files[4], files[3], files[5], files[6], files[1], files[0]]
  if (JSON.stringify(sequence) !== JSON.stringify(expected)) throw new Error(`${id}: coffee hold/lift/contact/sip/lower sequence changed`)
  let maxSilhouetteChange = 0, maxCrownStep = 0
  for (let index = 1; index < sequence.length; index++) {
    const a = inputs.find(input => input.file === sequence[index - 1]), b = inputs.find(input => input.file === sequence[index])
    maxSilhouetteChange = Math.max(maxSilhouetteChange, compareFrames(a.data, b.data, 256).silhouetteRatio)
    maxCrownStep = Math.max(maxCrownStep, Math.abs(observations.find(frame => frame.file === a.file).top - observations.find(frame => frame.file === b.file).top))
  }
  if (maxSilhouetteChange > .45 || maxCrownStep > 6) throw new Error(`${id}: discontinuous coffee frames`)
  const reference = await readFile(path.join(artRoot, 'packs', id, 'idle/right/001.png'))
  return { animation, inputs, fingerprint: { animation: sha(animationBytes), reference: sha(reference), frames: hashes },
    observations: { frames: observations, maxSilhouetteChange, maxCrownStep } }
}

async function publish(file, bytes, check) {
  try { if ((await readFile(file)).equals(bytes)) return } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (check) throw new Error(`Missing or stale coffee resource: ${file}`)
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.tmp-${process.pid}`
  await writeFile(temporary, bytes); await rename(temporary, file)
}

export async function buildOfficeCoffeeFrames({ outputRoot = path.join(root, 'public/characters'), artRoot = path.join(root, 'art/characters'), check = false } = {}) {
  const selection = JSON.parse(await readFile(path.join(artRoot, 'coffee-v1/integration-selection.json'), 'utf8'))
  if (selection.schemaVersion !== 1 || selection.status !== 'selected-for-integration') throw new Error('Coffee artwork must be selected for integration')
  const speech = JSON.parse(await readFile(path.join(artRoot, 'coffee-v1/speech-attachments.json'), 'utf8'))
  if (speech.schemaVersion !== 1 || JSON.stringify(Object.keys(speech.characters).sort()) !== JSON.stringify([...COFFEE_CHARACTERS].sort())) throw new Error('Invalid coffee speech attachments')
  const registry = CharacterRegistrySchema.parse(JSON.parse(await readFile(path.join(outputRoot, 'registry.json'), 'utf8')))
  const characters = [], audits = []
  for (const id of COFFEE_CHARACTERS) {
    // Existing actions keep their original admission policy and exact pixels.
    await assertCharacterAdmission(path.join(artRoot, 'packs', id))
    const coffee = await inspectCoffeeFrames(id, artRoot)
    if (JSON.stringify(selection.characters[id]) !== JSON.stringify(coffee.fingerprint)) throw new Error(`${id}: selected coffee artwork changed; renew the selection before publishing`)
    const entry = registry.characters.find(character => character.id === id)
    if (!entry) throw new Error(`Missing base office character: ${id}`)
    const base = CharacterManifestSchema.parse(JSON.parse(await readFile(path.join(outputRoot, entry.manifest), 'utf8')))
    const speechAttachment = speech.characters[id]
    if (speechAttachment.frameSha256 !== coffee.fingerprint.frames[coffee.animation.frames[0].file]
      || speechAttachment.mouth.view !== 'right' || !base.mouth?.views.right) throw new Error(`${id}: coffee mouth placement does not match its artwork`)
    const layers = [], frames = { ...base.frames }, keys = new Map()
    for (const [index, input] of coffee.inputs.entries()) {
      const key = `coffee-v1/right/${path.basename(input.file)}`
      if (frames[key]) throw new Error(`${id}: duplicate coffee frame key`)
      const { bounds } = input, x = index % 4 * 256, y = Math.floor(index / 4) * 384
      layers.push({ input: await sharp(input.bytes).extract(bounds).png().toBuffer(), left: x, top: y })
      frames[key] = { page: base.pages.length, rect: { x, y, width: bounds.width, height: bounds.height }, offset: { x: bounds.left, y: bounds.top } }
      keys.set(input.file, key)
    }
    const atlas = await sharp({ create: { width: 1024, height: 768, channels: 4, background: '#00000000' } }).composite(layers).webp({ lossless: true }).toBuffer()
    const image = `coffee-${sha(atlas).slice(0, 16)}.webp`
    const first = keys.get(coffee.animation.frames[0].file)
    const clips = { ...base.clips,
      'coffee.hold.right': { loop: true, frames: [{ frame: first, durationMs: 1000, mouth: speechAttachment.mouth }] },
      // Progress is supplied by the activity. A closed loop also keeps the label
      // socket on the first frame instead of following alpha-bound variations.
      'coffee.sip.right': { loop: true, frames: coffee.animation.frames.map((frame, index, list) => ({ frame: keys.get(frame.file), durationMs: index === 0 || index === list.length - 1 ? 100 : frame.durationMs })) },
      'coffee.hold.left': { alias: 'coffee.hold.right', mirrorX: true },
      'coffee.sip.left': { alias: 'coffee.sip.right', mirrorX: true },
    }
    const pages = [...base.pages, { image, width: 1024, height: 768, group: 'deferred' }]
    const revision = sha(json({ baseRevision: base.revision, coffee: coffee.fingerprint, frames, clips, pages })).slice(0, 16)
    const manifest = CharacterManifestSchema.parse({ ...base, revision, frames, clips, pages })
    const manifestFile = `${id}/manifest-${revision}.json`
    await publish(path.join(outputRoot, id, image), atlas, check)
    await publish(path.join(outputRoot, manifestFile), json(manifest), check)
    characters.push({ ...entry, manifest: manifestFile, clips: Object.keys(clips) })
    audits.push({ id, baseRevision: base.revision, revision, ...coffee.observations })
  }
  // Keep the base registry intact. Only the office application opts into these
  // composed manifests; standalone examples continue using the original packs.
  await publish(path.join(outputRoot, 'coffee-registry.json'), json(CharacterRegistrySchema.parse({ schemaVersion: 1, characters })), check)
  await publish(path.join(outputRoot, 'coffee-audit.json'), json({ schemaVersion: 1, characters: audits }), check)
  return characters.length
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.some(arg => arg !== '--check')) throw new Error('Usage: node scripts/build-office-coffee-frames.mjs [--check]')
  console.log(`Office coffee frame extensions ${args.includes('--check') ? 'verified' : 'built'}: ${await buildOfficeCoffeeFrames({ check: args.includes('--check') })}`)
}
