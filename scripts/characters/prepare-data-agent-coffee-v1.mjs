import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

// Artwork preparation only. This deliberately does not change the admitted
// character pack, asset registry, scene actions, or existing coffee effect.
const directory = new URL('../../art/characters/data-agent-coffee-v1/', import.meta.url)
const recipe = JSON.parse(await readFile(new URL('registration.json', directory), 'utf8'))
const source = new URL(recipe.source, directory)
const metadata = await sharp(fileURLToPath(source)).metadata()
if (metadata.width !== 1536 || metadata.height !== 1024 || !metadata.hasAlpha) {
  throw new Error('Expected the original 1536×1024 sheet with an alpha channel')
}
await mkdir(new URL('frames/right/', directory), { recursive: true })
const frames = []
const registrations = []
for (let index = 0; index < 8; index++) {
  const crop = { left: index % 4 * 384, top: Math.floor(index / 4) * 512, width: 384, height: 512 }
  const { scale, left, top } = recipe.transform
  const input = await sharp(fileURLToPath(source)).extract(crop)
    .resize(Math.round(crop.width * scale), Math.round(crop.height * scale)).png().toBuffer()
  const frame = await sharp({ create: { width: 256, height: 384, channels: 4, background: '#00000000' } })
    .composite([{ input, left, top }]).png().toBuffer()
  const file = `frames/right/${String(index + 1).padStart(3, '0')}.png`
  await writeFile(new URL(file, directory), frame)
  frames.push(frame)
  registrations.push({ file, crop, scale, left, top })
}
// Reuse frame 1 at the loop boundary instead of letting a slightly different
// generated return pose introduce an extra seam. All 8 source frames remain.
const manifest = {
  schemaVersion: 1,
  status: 'candidate-unreviewed',
  characterId: 'data-agent',
  canvas: { width: 256, height: 384 },
  pivot: { x: 128, y: 344 },
  referenceHeight: 280,
  view: 'right',
  loop: true,
  frames: recipe.sequence.map(({ frame, durationMs, phase }) => ({
    file: registrations[frame - 1].file, durationMs, phase,
  })),
  registrations,
}
await writeFile(new URL('animation.json', directory), JSON.stringify(manifest, null, 2) + '\n')
await sharp({ create: { width: 1024, height: 768, channels: 4, background: '#f3efeb' } })
  .composite(frames.map((input, index) => ({ input, left: index % 4 * 256, top: Math.floor(index / 4) * 384 })))
  .png().toFile(fileURLToPath(new URL('contact-sheet.png', directory)))
const previewFrames = []
for (const { frame } of recipe.sequence) {
  previewFrames.push(await sharp(frames[frame - 1]).flatten({ background: '#f3efeb' }).png().toBuffer())
}
await sharp(previewFrames, { join: { animated: true } })
  .gif({ loop: 0, delay: recipe.sequence.map(frame => frame.durationMs), dither: 0 })
  .toFile(fileURLToPath(new URL('preview.gif', directory)))
console.log(`Prepared unreviewed coffee frames: ${fileURLToPath(directory)}`)
