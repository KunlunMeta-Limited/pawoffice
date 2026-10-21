import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTestServer } from './helpers/vite.mjs'

let server, OfficeChatMarkdown
before(async () => {
  server = await createTestServer()
  ;({ OfficeChatMarkdown } = await server.ssrLoadModule('/apps/web/src/components/OfficeChatMarkdown.tsx'))
})
after(() => server?.close())

const render = (content, pending = false) => renderToStaticMarkup(createElement(OfficeChatMarkdown, { content, pending }))

test('chat replies render headings, emphasis, nested lists and quotes as Markdown', () => {
  const html = render('# 项目进展\n\n## 今日计划\n\n**重点**和*说明*\n\n- 第一项\n  - 子任务\n\n1. 确认\n2. 执行\n\n> 注意事项')
  assert(html.includes('<h1>项目进展</h1>'))
  assert(html.includes('<h2>今日计划</h2>'))
  assert(html.includes('<strong>重点</strong>和<em>说明</em>'))
  assert.match(html, /<ul>\s*<li>第一项\s*<ul>\s*<li>子任务<\/li>/)
  assert.match(html, /<ol>\s*<li>确认<\/li>\s*<li>执行<\/li>/)
  assert.match(html, /<blockquote>\s*<p>注意事项<\/p>/)
  assert(!html.includes('# 项目进展'))
  assert(!html.includes('**重点**'))
})

test('chat replies support GFM tables, task lists, strikethrough and links', () => {
  const html = render('| 任务 | 状态 |\n| --- | --- |\n| 修复 | 完成 |\n\n- [x] ~~旧问题~~\n- [ ] 新任务\n\n[文档](https://example.com/docs)')
  assert(html.includes('class="office-chat-table-scroll"><table>'))
  assert(html.includes('<th>任务</th>'))
  assert(html.includes('<td>完成</td>'))
  assert.match(html, /type="checkbox" disabled="" checked=""/)
  assert.match(html, /type="checkbox" disabled=""\/>/)
  assert(html.includes('<del>旧问题</del>'))
  assert(html.includes('href="https://example.com/docs" target="_blank" rel="noopener noreferrer">文档</a>'))
})

test('chat code preserves whitespace and literal Markdown and HTML characters', () => {
  const html = render('使用 `**原文**`\n\n```html\n<div>\n  # 标题 *原文*\n</div>\n```')
  assert(html.includes('<code>**原文**</code>'))
  assert(html.includes('<pre><code class="language-html">&lt;div&gt;\n  # 标题 *原文*\n&lt;/div&gt;\n</code></pre>'))
  assert(!html.includes('<strong>'))
})

test('chat replies escape raw HTML and filter unsafe link protocols', () => {
  const html = render('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[危险](javascript:alert%281%29)\n\n[安全](https://example.com)')
  assert(!html.includes('<script>'))
  assert(!html.includes('<img'))
  assert(!html.includes('href="javascript:'))
  assert(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))
  assert(html.includes('href="https://example.com"'))
})

test('streaming replies render incomplete Markdown and stop showing the caret on completion', () => {
  const partial = render('## 结果\n\n```ts\nconst value = 1', true)
  assert(partial.includes('<h2>结果</h2>'))
  assert(partial.includes('<pre><code class="language-ts">const value = 1\n</code></pre>'))
  assert(partial.includes('class="office-chat-caret" aria-hidden="true"'))
  const completed = render('## 结果\n\n```ts\nconst value = 1\n```')
  assert(!completed.includes('office-chat-caret'))
})

test('ordinary replies retain paragraphs and single line breaks', () => {
  const html = render('第一行\n第二行\n\n下一段')
  assert(html.includes('<p>第一行\n第二行</p>'))
  assert(html.includes('<p>下一段</p>'))
})
