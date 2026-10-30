import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createPawOfficeServer } from '../server/dist/app.js'
import { createWorkflowMock } from '../integration/clients/workflow-mock.mjs'
import { OFFICE_ROSTER } from '@pawoffice/scene-office/core/roster'

test('every showcase stage fits the real API and preserves meaningful task and result states', async () => {
  const relay = await createPawOfficeServer()
  const baseUrl = await relay.listen({ host: '127.0.0.1', port: 0 })
  try {
    for (let round = 1; round <= 5; round++) {
      const mock = createWorkflowMock({ baseUrl, scenario: 'ecommerce', mode: 'showcase', round })
      try {
        const url = await mock.app.listen({ host: '127.0.0.1', port: 0 })
        await mock.initialize(url)
        const conversation = mock.office.conversations[0]
        const board = conversation.whiteboard
        assert.equal(board.result.artifacts.length, [1, 5, 5, 6, 7][round - 1])
        assert.deepEqual(conversation.employees.map(({ id, sceneActorId, name }) => ({ id, sceneActorId, name })),
          OFFICE_ROSTER.map(({ id, name }) => ({ id, sceneActorId: id, name })))
        assert.equal(conversation.tasks.length, 8)
        assert.equal(board.result.teamSize, conversation.employees.length)
        for (const task of conversation.tasks) {
          const employee = conversation.employees.find(employee => employee.id === task.assigneeId)
          assert(employee, `task ${task.id} must resolve to an office member`)
          assert.equal(board.result.tasks.find(item => item.id === task.id).owner, employee.name)
        }
        assert.equal(new Set(conversation.tasks.map(task => task.assigneeId)).size, 6)
        assert.equal(conversation.tasks.find(task => task.id === 'visual').assigneeId, 'file-agent')
        for (const event of conversation.events) assert(conversation.employees.some(employee => employee.id === event.employeeId))
        const collaboration = board.detailSections.find(section => section.id === 'agent-collaboration')
        const table = collaboration.blocks.find(block => block.type === 'table')
        assert.deepEqual(table.rows.map(row => row.agent).sort(), conversation.employees.map(employee => employee.name).sort())
        const graph = collaboration.blocks.find(block => block.type === 'diagram').source
        for (const employee of conversation.employees) assert(graph.includes(employee.name))
        assert(!/小禾|林策|知文|数研|慎审|五位/.test(JSON.stringify(conversation)))
        assert.equal(board.detailSections.length, 3)
        if (round < 4) assert(!board.result.metrics.some(metric => metric.id === 'orders'))
        if (round === 5) {
          assert.equal(board.status, 'blocked')
          assert.equal(board.result.status, 'verified')
          assert.equal(board.result.tasks.filter(task => task.status === 'done').length, 7)
        }
        for (let sequence = 1; sequence <= round; sequence++) {
          const response = await fetch(`${url}/deliveries/main-delivery-${sequence}`)
          const raw = await response.text()
          assert(Buffer.byteLength(raw) <= 64 * 1024)
          assert.equal(JSON.parse(raw).turnId, `showcase-main-turn-${sequence}`)
        }
        if (round >= 3) {
          const oldBudget = await (await fetch(`${url}/versions/budget-v1`)).text()
          const currentBudget = await (await fetch(`${url}/versions/budget-v${round >= 4 ? 3 : 2}`)).text()
          assert(oldBudget.includes('3000')); assert(currentBudget.includes('1800'))
          const historical = await (await fetch(`${url}/deliveries/main-delivery-2`)).json()
          assert.equal(historical.board.summary.includes('3000'), true)
          assert.equal(historical.result.artifacts.find(item => item.id === 'budget').content, '')
          assert.equal(historical.result.artifacts.find(item => item.id === 'budget').sha256, createHash('sha256').update(oldBudget).digest('hex'))
        }
      } finally { await mock.app.close() }
    }
  } finally { await relay.close() }
})

test('PowerShell 7 command actually loads the requested showcase stage', { skip: process.platform !== 'win32', timeout: 30000 }, async () => {
  const relay = await createPawOfficeServer()
  const baseUrl = await relay.listen({ host: '127.0.0.1', port: 0 })
  const reservation = createServer()
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
  const port = reservation.address().port
  await new Promise(resolve => reservation.close(resolve))
  const child = spawn('pwsh', ['-NoProfile', '-File', 'integration/clients/start-workflow-mock.ps1', '-BaseUrl', baseUrl, '-Port', String(port), '-Mode', 'showcase', '-Round', '3'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`PowerShell readiness timeout: ${output.slice(-1000)}`)), 15000)
      const receive = chunk => {
        output += chunk
        if (output.includes('已载入第3轮完整页面')) { clearTimeout(timer); resolve() }
      }
      child.stdout.on('data', receive); child.stderr.on('data', receive)
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`PowerShell exited ${code}: ${output.slice(-1000)}`)) })
    })
    const delivery = await (await fetch(`http://127.0.0.1:${port}/deliveries/main-delivery-3`)).json()
    assert.equal(delivery.title, '预算与文案改版')
    assert(delivery.result.artifacts.some(item => item.versionId === 'budget-v2'))
    assert.equal((await fetch(`http://127.0.0.1:${port}/deliveries/main-delivery-4`)).status, 404)
  } finally {
    // Terminate only the PowerShell process tree started by this test, including its Node child.
    if (child.pid && child.exitCode === null) await promisify(execFile)('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }).catch(() => {})
    await relay.close()
  }
})
