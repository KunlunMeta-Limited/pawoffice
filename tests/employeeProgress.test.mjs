import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTestServer } from './helpers/vite.mjs'

let server, EmployeeTaskList
before(async () => {
  server = await createTestServer()
  ;({ EmployeeTaskList } = await server.ssrLoadModule('/apps/web/src/ui/OfficeShell.tsx'))
})
after(() => server?.close())

test('employee progress shows each assigned task and only reported percentages', () => {
  const employees = [
    { id: 'alice', name: '甲', online: true },
    { id: 'bob', name: '乙' },
    { id: 'idle', name: '丙' },
  ]
  const tasks = [
    { id: 'a1', title: '需求分析', assigneeId: 'alice', status: 'running', progress: 42 },
    { id: 'a2', title: '验收准备', assigneeId: 'alice', status: 'blocked', progress: -1 },
    { id: 'b1', title: '交付归档', assigneeId: 'bob', status: 'completed' },
  ]
  const html = renderToStaticMarkup(createElement(EmployeeTaskList, { employees, tasks, appearanceIds: {} }))
  const alice = html.match(/<section[^>]*aria-label="甲的工作进度"[\s\S]*?<\/section>/)?.[0]
  const bob = html.match(/<section[^>]*aria-label="乙的工作进度"[\s\S]*?<\/section>/)?.[0]
  const idle = html.match(/<section[^>]*aria-label="丙的工作进度"[\s\S]*?<\/section>/)?.[0]
  assert(alice?.includes('需求分析') && alice.includes('进行中') && alice.includes('42%'))
  assert(alice.includes('验收准备') && alice.includes('待处理') && alice.includes('进度未提供'))
  assert.match(alice, /aria-label="需求分析进度"[^>]*aria-valuenow="42"/)
  assert(!alice.includes('aria-label="验收准备进度"'))
  assert(bob?.includes('交付归档') && bob.includes('已完成') && bob.includes('进度未提供'))
  assert(!bob.includes('100%'))
  assert(idle?.includes('暂无分配任务'))
})
