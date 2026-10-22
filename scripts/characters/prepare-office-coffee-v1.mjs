import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

// Isolated artwork preparation; does not modify admitted packs or runtime.
const art = new URL('../../art/characters/', import.meta.url)
const ids = ['office-lead', 'code-agent', 'file-agent', 'app-agent', 'review-agent']
const existing = new URL('data-agent-coffee-v1/', art)
const sequence = JSON.parse(await readFile(new URL('registration.json', existing), 'utf8')).sequence
const template = await readFile(new URL('preview.html', existing), 'utf8')
const reports = []

function bounds(data, width, height) {
  let left = width, right = -1, top = height, bottom = -1
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] < 128) continue
    left = Math.min(left, x); right = Math.max(right, x)
    top = Math.min(top, y); bottom = Math.max(bottom, y)
  }
  if (right < left) throw new Error('Empty character frame')
  return { left, right, top, footY: bottom + 1,
    edgeClipped: left === 0 || top === 0 || right === width - 1 || bottom === height - 1 }
}

function footAnchor(data, width, height) {
  const measured = bounds(data, width, height)
  let left = width, right = -1
  for (let y = Math.max(0, measured.footY - 20); y < measured.footY; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] < 128) continue
    left = Math.min(left, x); right = Math.max(right, x)
  }
  return { x: (left + right) / 2, y: measured.footY }
}

for (const id of ids) {
  const directory = new URL(`${id}-coffee-v1/`, art)
  const pack = new URL(`packs/${id}/`, art)
  const character = JSON.parse(await readFile(new URL('character.json', pack), 'utf8'))
  const source = new URL('source-sheet.png', directory)
  const metadata = await sharp(fileURLToPath(source)).metadata()
  if (metadata.width !== 1536 || metadata.height !== 1024 || !metadata.hasAlpha) {
    throw new Error(`${id}: expected 1536×1024 with alpha`)
  }
  const neutral = await sharp(fileURLToPath(source)).extract({ left: 0, top: 0, width: 384, height: 512 })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const original = await sharp(fileURLToPath(new URL('idle/right/001.png', pack)))
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const originalBounds = bounds(original.data, original.info.width, original.info.height)
  const neutralBounds = bounds(neutral.data, 384, 512)
  // One scale per sequence. Generated grid spacing is uneven, so register each
  // COMPLETE figure by its shoe anchor, never by stretching individual limbs.
  const scale = (originalBounds.footY - originalBounds.top) / (neutralBounds.footY - neutralBounds.top)
  const targetAnchor = footAnchor(original.data, original.info.width, original.info.height)
  const recipe = { source: 'source-sheet.png', scale, alignment: 'whole-figure-shoe-anchor', targetAnchor,
    calibration: { originalBounds, neutralBounds }, sequence }
  await writeFile(new URL('registration.json', directory), JSON.stringify(recipe, null, 2) + '\n')
  await mkdir(new URL('frames/right/', directory), { recursive: true })
  const frames = [], registrations = [], observations = []
  for (let index = 0; index < 8; index++) {
    const crop = { left: index % 4 * 384, top: Math.floor(index / 4) * 512, width: 384, height: 512 }
    const raw = await sharp(fileURLToPath(source)).extract(crop).ensureAlpha().raw().toBuffer()
    if (bounds(raw, 384, 512).edgeClipped) throw new Error(`${id}/${index + 1}: source touches cell boundary`)
    const anchor = footAnchor(raw, 384, 512)
    const left = Math.round(targetAnchor.x - anchor.x * scale)
    const top = Math.round(targetAnchor.y - anchor.y * scale)
    const input = await sharp(fileURLToPath(source)).extract(crop)
      .resize(Math.round(384 * scale), Math.round(512 * scale)).png().toBuffer()
    const rendered = await sharp({ create: { width: 256, height: 384, channels: 4, background: '#00000000' } })
      .composite([{ input, left, top }]).raw().toBuffer()
    // Resampling leaves isolated alpha=1 noise at the canvas boundary in a few
    // generated cells. Remove only that quantization residue; preserve artwork.
    for (let offset = 3; offset < rendered.length; offset += 4) if (rendered[offset] === 1) rendered[offset] = 0
    const frame = await sharp(rendered, { raw: { width: 256, height: 384, channels: 4 } }).png().toBuffer()
    const file = `frames/right/${String(index + 1).padStart(3, '0')}.png`
    await writeFile(new URL(file, directory), frame)
    const rgba = await sharp(frame).ensureAlpha().raw().toBuffer()
    const observed = { frame: index + 1, ...bounds(rgba, 256, 384) }
    if (observed.edgeClipped) throw new Error(`${id}/${index + 1}: registered frame touches canvas boundary`)
    observations.push(observed); frames.push(frame)
    registrations.push({ file, crop, scale, left, top, sourceShoeAnchor: anchor, targetShoeAnchor: targetAnchor, alphaNoiseCutoff: 1 })
  }
  const manifest = { schemaVersion: 1, status: 'candidate-unreviewed', characterId: id, label: character.label,
    canvas: { width: 256, height: 384 }, pivot: { x: 128, y: 344 }, referenceHeight: 280,
    view: 'right', loop: true,
    frames: sequence.map(({ frame, durationMs, phase }) => ({ file: registrations[frame - 1].file, durationMs, phase })), registrations }
  await writeFile(new URL('animation.json', directory), JSON.stringify(manifest, null, 2) + '\n')
  await sharp({ create: { width: 1024, height: 768, channels: 4, background: '#f3efeb' } })
    .composite(frames.map((input, index) => ({ input, left: index % 4 * 256, top: Math.floor(index / 4) * 384 })))
    .png().toFile(fileURLToPath(new URL('contact-sheet.png', directory)))
  const previewFrames = []
  for (const { frame } of sequence) previewFrames.push(await sharp(frames[frame - 1]).flatten({ background: '#f3efeb' }).png().toBuffer())
  await sharp(previewFrames, { join: { animated: true } })
    .gif({ loop: 0, delay: sequence.map(frame => frame.durationMs), dither: 0 })
    .toFile(fileURLToPath(new URL('preview.gif', directory)))
  const page = template.replaceAll('赵审', character.label)
    .replace('同一倍率和画布位置导入，未对局部肢体进行拉伸。', '采用同一倍率，按脚底和鞋子站位配准完整人物，未拉伸局部肢体。')
  await writeFile(new URL('preview.html', directory), page)
  const report = { characterId: id, label: character.label, status: 'candidate-unreviewed', observations }
  await writeFile(new URL('observations.json', directory), JSON.stringify(report, null, 2) + '\n')
  reports.push(report)
  const feet = observations.map(frame => frame.footY)
  const tops = observations.map(frame => frame.top)
  await writeFile(new URL('README.md', directory), `# ${character.label}咖啡动作候选 v1

状态：candidate-unreviewed，未正式发布。

- 原始生成图：source-sheet.png；内置 image_gen 提示词与来源：generation.json。
- 八张 256×384 透明帧：frames/right/001.png 至 008.png。
- 动画：preview.gif；逐帧页：preview.html；对照表：contact-sheet.png。
- 时长与每帧完整配准：animation.json；第一帧倍率定标记录：registration.json。
- 端杯、屈肘举杯、嘴部接触、倾杯、移开、放下；循环复用第 1 帧收尾，第 8 帧保留供比较。
- 原始图网格间距不均；整个序列保持同一等比倍率，按脚底和鞋子站位平移完整人物。各帧源锚点与偏移均有记录，没有局部肢体拉伸或分帧缩放。
- alpha ≥128 的观测：足底 ${Math.min(...feet)}–${Math.max(...feet)}，头顶 ${Math.min(...tops)}–${Math.max(...tops)}；所有帧均未触及画布边缘。
- 仍有生成图轮廓差异；握杯与嘴部接触需人工确认，未宣称准入审计或视觉验收通过。
- 当前只绘制与首个样片相同的右侧动作；正/背视图未制作，未改正式人物包和办公室代码。

复现：在仓库根目录运行 node scripts/characters/prepare-office-coffee-v1.mjs。准入规则见 docs/character-admission.md。
`)
  console.log(`${id} (${character.label}): eight transparent frames prepared`)
}

const gallery = new URL('coffee-v1/', art)
await mkdir(gallery, { recursive: true })
await writeFile(new URL('observations.json', gallery), JSON.stringify(reports, null, 2) + '\n')
const prompts = await Promise.all(ids.map(async id => ({ characterId: id,
  ...JSON.parse(await readFile(new URL(`${id}-coffee-v1/generation.json`, art), 'utf8')) })))
await writeFile(new URL('prompts.json', gallery), JSON.stringify(prompts, null, 2) + '\n')
const allIds = [...ids, 'data-agent']
const overview = []
for (const { frame } of sequence) {
  const layers = []
  for (const [index, id] of allIds.entries()) {
    layers.push({ input: await readFile(new URL(`${id}-coffee-v1/frames/right/${String(frame).padStart(3, '0')}.png`, art)),
      left: index % 3 * 256, top: Math.floor(index / 3) * 384 })
  }
  overview.push(await sharp({ create: { width: 768, height: 768, channels: 4, background: '#f3efeb' } })
    .composite(layers).png().toBuffer())
}
await sharp(overview, { join: { animated: true } })
  .gif({ loop: 0, delay: sequence.map(frame => frame.durationMs), dither: 0 })
  .toFile(fileURLToPath(new URL('preview.gif', gallery)))
await writeFile(new URL('sip-overview.png', gallery), overview[4])
