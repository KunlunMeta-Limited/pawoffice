import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { readQualityInputs } from '../scripts/characters/quality.mjs'

const packs = fileURLToPath(new URL('../art/characters/packs/', import.meta.url))
const baseline = JSON.parse(await readFile(new URL('../scripts/characters/legacy-baseline.json', import.meta.url), 'utf8'))

test('checked-out legacy character packs keep their frozen admission fingerprints', async () => {
  for (const [id, expected] of Object.entries(baseline.characters)) {
    const input = await readQualityInputs(path.join(packs, id))
    assert.equal(input.digest, expected, `${id}: checkout changed fingerprinted bytes`)
  }
})
