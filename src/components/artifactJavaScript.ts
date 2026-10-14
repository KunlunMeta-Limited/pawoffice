import { parse, type Node, type Program } from 'acorn'

/**
 * 功能：描述 JavaScript 产物的静态语法和顶层结构解析结果。
 * 字段/变体语义：`ok` 区分成功与失败；成功时包含语法类型和声明摘要，失败时包含错误位置。
 * 数据来源：Acorn 对工作区脚本文本的只读解析；数据去向：文件中心和产物查看器。
 * 约束：解析过程绝不执行脚本；只收集顶层公开结构；稳定性：新增摘要字段保持向后兼容。
 * 关联：CHG-2026-0019、TEST-XCHG-009。
 */
export type JavaScriptParseResult = {
  /** 表示 Acorn 已成功生成语法树。 */
  ok: true
  /** 实际采用的 ECMAScript 源码类型。 */
  sourceType: 'module' | 'script'
  /** 顶层静态 import 的模块来源。 */
  imports: string[]
  /** 顶层 ESM 导出名称。 */
  exports: string[]
  /** 顶层具名函数声明。 */
  functions: string[]
  /** 顶层具名类声明。 */
  classes: string[]
  /** 顶层简单标识符变量声明。 */
  variables: string[]
  /** 顶层 CommonJS 赋值目标。 */
  commonJsExports: string[]
} | {
  /** 表示两种源码类型均未通过语法解析。 */
  ok: false
  /** 已去除重复位置后缀的 Acorn 错误摘要。 */
  message: string
  /** 一基语法错误行号。 */
  line?: number
  /** 一基语法错误列号。 */
  column?: number
}

type AstNode = Node & Record<string, unknown>

function identifierName(node: unknown): string | null {
  if (!node || typeof node !== 'object') return null
  const value = node as AstNode
  if (value.type === 'Identifier' && typeof value.name === 'string') return value.name
  if (value.type === 'Literal' && (typeof value.value === 'string' || typeof value.value === 'number')) return String(value.value)
  return null
}

function memberName(node: unknown): string | null {
  if (!node || typeof node !== 'object') return null
  const value = node as AstNode
  if (value.type !== 'MemberExpression') return identifierName(value)
  const object = memberName(value.object)
  const property = identifierName(value.property)
  return object && property ? `${object}.${property}` : null
}

function collectDeclaration(node: unknown, output: Extract<JavaScriptParseResult, { ok: true }>) {
  if (!node || typeof node !== 'object') return
  const value = node as AstNode
  if (value.type === 'FunctionDeclaration') {
    const name = identifierName(value.id)
    if (name) output.functions.push(name)
  } else if (value.type === 'ClassDeclaration') {
    const name = identifierName(value.id)
    if (name) output.classes.push(name)
  } else if (value.type === 'VariableDeclaration' && Array.isArray(value.declarations)) {
    for (const declaration of value.declarations as AstNode[]) {
      const name = identifierName(declaration.id)
      if (name) output.variables.push(name)
    }
  }
}

function unique(values: string[]) {
  return [...new Set(values)]
}

function parseProgram(source: string, sourceType: 'module' | 'script') {
  return parse(source, { ecmaVersion: 'latest', sourceType, locations: true })
}

/**
 * 功能：静态解析 JavaScript、MJS 或 CJS 正文并提取顶层结构。
 * 参数：`path` 为产物相对路径，用于选择 module/script 优先级；`source` 为脚本文本。
 * 返回：解析成功时返回语法类型、导入导出和声明摘要；失败时返回 Acorn 行列信息。
 * 错误：语法错误被转换为 `ok=false`，不会向 React 抛出。
 * 状态：纯函数，不修改浏览器、文件或工作区状态。
 * 并发与取消：同步且无共享状态；由调用方控制文件读取取消。
 * 权限：只做 AST 解析，禁止 `eval`、`Function`、动态 import 或 DOM 注入。
 * 关联：CHG-2026-0019、TEST-XCHG-009。
 */
export function parseArtifactJavaScript(path: string, source: string): JavaScriptParseResult {
  const extension = path.toLocaleLowerCase().split('.').pop()
  const attempts: Array<'module' | 'script'> = extension === 'mjs' ? ['module', 'script'] : ['script', 'module']
  let lastError: unknown
  let program: Program | null = null
  let sourceType: 'module' | 'script' = attempts[0]
  for (const candidate of attempts) {
    try {
      program = parseProgram(source, candidate)
      sourceType = candidate
      break
    } catch (error) {
      lastError = error
    }
  }
  if (!program) {
    const failure = lastError as { message?: string; loc?: { line?: number; column?: number } }
    return {
      ok: false,
      message: failure?.message?.replace(/\s*\(\d+:\d+\)\s*$/u, '') || 'JavaScript 语法无法解析',
      ...(Number.isFinite(failure?.loc?.line) ? { line: failure.loc?.line } : {}),
      ...(Number.isFinite(failure?.loc?.column) ? { column: Number(failure.loc?.column) + 1 } : {}),
    }
  }

  const output: Extract<JavaScriptParseResult, { ok: true }> = {
    ok: true,
    sourceType,
    imports: [],
    exports: [],
    functions: [],
    classes: [],
    variables: [],
    commonJsExports: [],
  }
  for (const statement of program.body as AstNode[]) {
    collectDeclaration(statement, output)
    if (statement.type === 'ImportDeclaration') {
      const imported = identifierName(statement.source)
      if (imported) output.imports.push(imported)
    } else if (statement.type === 'ExportDefaultDeclaration') {
      output.exports.push('default')
      collectDeclaration(statement.declaration, output)
    } else if (statement.type === 'ExportNamedDeclaration') {
      collectDeclaration(statement.declaration, output)
      if (Array.isArray(statement.specifiers)) {
        for (const specifier of statement.specifiers as AstNode[]) {
          const name = identifierName(specifier.exported)
          if (name) output.exports.push(name)
        }
      }
      const declaration = statement.declaration as AstNode | null
      const declaredName = declaration && (identifierName(declaration.id)
        || (Array.isArray(declaration.declarations) ? identifierName((declaration.declarations[0] as AstNode)?.id) : null))
      if (declaredName) output.exports.push(declaredName)
    } else if (statement.type === 'ExportAllDeclaration') {
      output.exports.push('*')
    } else if (statement.type === 'ExpressionStatement') {
      const expression = statement.expression as AstNode | undefined
      if (expression?.type === 'AssignmentExpression') {
        const target = memberName(expression.left)
        if (target === 'module.exports' || target?.startsWith('module.exports.') || target?.startsWith('exports.')) {
          output.commonJsExports.push(target)
        }
      }
    }
  }
  output.imports = unique(output.imports)
  output.exports = unique(output.exports)
  output.functions = unique(output.functions)
  output.classes = unique(output.classes)
  output.variables = unique(output.variables)
  output.commonJsExports = unique(output.commonJsExports)
  return output
}
