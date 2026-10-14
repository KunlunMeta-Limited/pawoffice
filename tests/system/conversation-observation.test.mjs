// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  observationMismatch,
  observationSignature,
  validateTurnObservation,
  waitForStableTurn,
} from './conversation-observation.mjs'

function completedObservation(hash, gatewayHash = hash) {
  return {
    turnID: 'turn-1',
    targetUserMessageID: 'user-1',
    hostState: 'completed',
    hostErrorCode: null,
    hostAssistant: true,
    gatewayAssistant: true,
    hostAssistantHash: hash,
    gatewayAssistantHash: gatewayHash,
    hostAssistantLength: 10,
    gatewayAssistantLength: 10,
    gatewayErrorText: null,
    gatewayCancelledText: null,
  }
}

describe('conversation observation stability', () => {
  it('不把第一次 Host/Gateway 正文不同的窗口判为通过', async () => {
    const samples = [
      completedObservation('host-before-commit', 'gateway-before-commit'),
      completedObservation('same-final', 'same-final'),
      completedObservation('same-final', 'same-final'),
    ]
    let index = 0
    const result = await waitForStableTurn(
      async () => samples[Math.min(index++, samples.length - 1)],
      { expectedTurnID: 'turn-1', timeoutMs: 100 },
    )
    expect(result.observation.hostAssistantHash).toBe('same-final')
    expect(result.stability.attempts).toBe(2)
    expect(result.stability.lastMismatch).toBe('Host 与 Gateway assistant 正文摘要不一致')
    expect(result.stability.mismatches).toEqual([{
      attempt: 1,
      message: 'Host 与 Gateway assistant 正文摘要不一致',
    }])
  })

  it('一次读取异常恢复后仍要求两次连续稳定采样', async () => {
    let calls = 0
    const result = await waitForStableTurn(async () => {
      calls += 1
      if (calls === 1) throw new Error('Gateway messages 临时不可用')
      return completedObservation('same-final')
    }, { expectedTurnID: 'turn-1', timeoutMs: 200 })
    expect(result.observation.hostAssistantHash).toBe('same-final')
    expect(calls).toBe(3)
    expect(result.stability.attempts).toBe(2)
    expect(result.stability.mismatches).toEqual([{
      attempt: 1,
      message: 'Gateway messages 临时不可用',
    }])
  })

  it('失败终态先到而 Gateway 正文后到时不能提前通过', async () => {
    const failed = {
      turnID: 'turn-1',
      targetUserMessageID: 'user-1',
      hostState: 'failed',
      hostErrorCode: 'provider_rate_limited',
      hostAssistant: false,
      gatewayAssistant: false,
      gatewayErrorText: '请求过于频繁',
      gatewayCancelledText: null,
    }
    const samples = [
      { ...failed, gatewayErrorText: null },
      failed,
      failed,
    ]
    let index = 0
    const result = await waitForStableTurn(
      async () => samples[Math.min(index++, samples.length - 1)],
      { expectedStates: ['failed'], expectedTurnID: 'turn-1', timeoutMs: 200 },
    )
    expect(result.observation.gatewayErrorText).toBe('请求过于频繁')
    expect(result.stability.attempts).toBe(2)
  })

  it('意外终态立即返回脱敏的最后观测快照', async () => {
    const error = await waitForStableTurn(
      async () => ({
        ...completedObservation('unused'),
        hostState: 'failed',
        hostErrorCode: 'provider_timeout',
        hostAssistant: false,
        gatewayAssistant: false,
        hostAssistantHash: null,
        gatewayAssistantHash: null,
        gatewayErrorText: '响应超时',
      }),
      { expectedStates: ['completed'], expectedTurnID: 'turn-1', timeoutMs: 200 },
    ).then(() => null, (value) => value)
    expect(error.code).toBe('unexpected_terminal_state')
    expect(error.lastObservation.hostErrorCode).toBe('provider_timeout')
    expect(JSON.stringify(error.lastObservation)).not.toContain('assistant 原文')
  })

  it('目标 turnID 缺失时拒绝回退到最后一个回合', () => {
    expect(() => validateTurnObservation({ ...completedObservation('same-final'), turnID: 'turn-2' }, ['completed'], 'turn-1'))
      .toThrow('观测未精确命中请求的 turnID')
  })

  it('失败和取消必须有对应的 Gateway 正文投影', () => {
    expect(() => validateTurnObservation({ turnID: 'turn-1', hostState: 'failed' }, ['failed'], 'turn-1'))
      .toThrow('failed 终态缺少 Gateway 失败正文投影')
    expect(() => validateTurnObservation({ turnID: 'turn-1', hostState: 'cancelled' }, ['cancelled'], 'turn-1'))
      .toThrow('cancelled 终态缺少 Gateway 取消正文投影')
  })

  it('签名只包含一致性字段，不把正文内容写入诊断摘要', () => {
    expect(observationSignature(completedObservation('hash-a'))).toContain('"turnID":"turn-1"')
    expect(observationSignature(completedObservation('hash-a'))).not.toContain('assistant 原文')
    expect(observationMismatch(completedObservation('hash-a'), completedObservation('hash-b')))
      .toBe('两次采样的 Host assistant 摘要不一致')
  })
})
