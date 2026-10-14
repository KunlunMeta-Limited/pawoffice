import { describe, expect, it } from 'vitest'
import { parseArtifactJavaScript } from '@/components/artifactJavaScript'

describe('JavaScript 产物静态解析', () => {
  it('解析 ES Module 的导入导出和声明', () => {
    const result = parseArtifactJavaScript('deliverable.mjs', `
      import value from './source.js'
      export const total = value + 1
      export function render() { return total }
      export default class Report {}
    `)
    expect(result).toMatchObject({
      ok: true,
      sourceType: 'module',
      imports: ['./source.js'],
      exports: ['total', 'render', 'default'],
      functions: ['render'],
      classes: ['Report'],
      variables: ['total'],
    })
  })

  it('解析 CommonJS 导出且不执行脚本', () => {
    delete (globalThis as { __artifactExecuted?: boolean }).__artifactExecuted
    const result = parseArtifactJavaScript('deliverable.cjs', `
      globalThis.__artifactExecuted = true
      function createReport() { return 'ok' }
      module.exports = { createReport }
      exports.version = '1.0'
    `)
    expect(result).toMatchObject({
      ok: true,
      sourceType: 'script',
      functions: ['createReport'],
      commonJsExports: ['module.exports', 'exports.version'],
    })
    expect((globalThis as { __artifactExecuted?: boolean }).__artifactExecuted).toBeUndefined()
  })

  it('返回语法错误的行列而不是执行或抛出', () => {
    const result = parseArtifactJavaScript('broken.js', 'const answer = ;')
    expect(result).toMatchObject({ ok: false, line: 1 })
    if (!result.ok) {
      expect(result.column).toBeGreaterThan(1)
      expect(result.message).toBeTruthy()
    }
  })
})
