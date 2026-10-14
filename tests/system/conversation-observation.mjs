/**
 * 对话三端观测辅助：把一次并行读取视为采样，不把采样本身当成一致性证明。
 * 输入输出边界：输入为 Host/Gateway 观测结果和期望终态，输出为稳定观测或脱敏诊断错误。
 * 并发约束：调用方负责保证每次采样读取同一个 session；本模块不修改运行态。
 */

export function observationSignature(observation) {
  return JSON.stringify({
    turnID: observation?.turnID || null,
    targetUserMessageID: observation?.targetUserMessageID || null,
    hostState: observation?.hostState || null,
    hostErrorCode: observation?.hostErrorCode || null,
    hostAssistant: Boolean(observation?.hostAssistant),
    gatewayAssistant: Boolean(observation?.gatewayAssistant),
    hostAssistantHash: observation?.hostAssistantHash || null,
    gatewayAssistantHash: observation?.gatewayAssistantHash || null,
    hostAssistantLength: observation?.hostAssistantLength || 0,
    gatewayAssistantLength: observation?.gatewayAssistantLength || 0,
    gatewayError: observation?.gatewayErrorText ? true : false,
    gatewayCancelled: observation?.gatewayCancelledText ? true : false,
  })
}

export function observationMismatch(first, second) {
  if (first?.turnID !== second?.turnID) return '两次采样的 turnID 不一致'
  if (first?.targetUserMessageID !== second?.targetUserMessageID) return '两次采样的 userMessageID 不一致'
  if (first?.hostState !== second?.hostState) return '两次采样的 Host 终态不一致'
  if (first?.hostErrorCode !== second?.hostErrorCode) return '两次采样的 Host 错误码不一致'
  if (first?.hostAssistantHash !== second?.hostAssistantHash) return '两次采样的 Host assistant 摘要不一致'
  if (first?.gatewayAssistantHash !== second?.gatewayAssistantHash) return '两次采样的 Gateway assistant 摘要不一致'
  if ((first?.gatewayErrorText || null) !== (second?.gatewayErrorText || null)) return '两次采样的 Gateway 失败投影不一致'
  if ((first?.gatewayCancelledText || null) !== (second?.gatewayCancelledText || null)) return '两次采样的 Gateway 取消投影不一致'
  return null
}

export function validateTurnObservation(observation, expectedStates, expectedTurnID) {
  if (!observation || observation.turnID !== expectedTurnID) {
    throw new Error('观测未精确命中请求的 turnID')
  }
  if (!expectedStates.includes(observation.hostState)) {
    throw new Error(`观测到非预期 Host 终态：${observation.hostState}`)
  }
  if (observation.hostState === 'completed') {
    if (!observation.hostAssistant || !observation.gatewayAssistant) {
      throw new Error('completed 终态缺少 Host 或 Gateway assistant 正文')
    }
    if (!observation.hostAssistantHash || observation.hostAssistantHash !== observation.gatewayAssistantHash) {
      throw new Error('Host 与 Gateway assistant 正文摘要不一致')
    }
    if (observation.gatewayErrorText || observation.gatewayCancelledText) {
      throw new Error('completed 终态同时出现失败或取消投影')
    }
  }
  if (observation.hostState === 'failed' && !observation.gatewayErrorText) {
    throw new Error('failed 终态缺少 Gateway 失败正文投影')
  }
  if (observation.hostState === 'cancelled' && !observation.gatewayCancelledText) {
    throw new Error('cancelled 终态缺少 Gateway 取消正文投影')
  }
  return observation
}

/**
 * 等待两个连续采样稳定，而不是等待一个固定时间后直接判定。
 * 每次采样内部可并行读取多个端点；只有目标回合、终态和正文摘要连续一致才返回。
 */
export async function waitForStableTurn(observe, options = {}) {
  const expectedStates = options.expectedStates || ['completed']
  const expectedTurnID = options.expectedTurnID
  const timeoutMs = options.timeoutMs ?? 120_000
  const startedAt = Date.now()
  let attempts = 0
  let lastError = null
  let lastMismatch = null
  let lastObservation = null
  const mismatches = []
  const terminalStates = new Set(['completed', 'failed', 'cancelled'])
  while (Date.now() - startedAt < timeoutMs) {
    attempts += 1
    try {
      const firstSample = await observe()
      lastObservation = firstSample
      if (terminalStates.has(firstSample?.hostState) && !expectedStates.includes(firstSample.hostState)) {
        throw new Error(`观测到非预期 Host 终态：${firstSample.hostState}`)
      }
      const first = validateTurnObservation(firstSample, expectedStates, expectedTurnID)
      const secondSample = await observe()
      lastObservation = secondSample
      if (terminalStates.has(secondSample?.hostState) && !expectedStates.includes(secondSample.hostState)) {
        throw new Error(`观测到非预期 Host 终态：${secondSample.hostState}`)
      }
      const second = validateTurnObservation(secondSample, expectedStates, expectedTurnID)
      const mismatch = observationMismatch(first, second)
      if (mismatch) {
        lastMismatch = mismatch
        throw new Error(mismatch)
      }
      return {
        observation: second,
        stability: {
          attempts,
          consecutiveStableReads: 2,
          lastMismatch,
          mismatches,
        },
      }
    } catch (error) {
      lastError = error
      const diagnostic = error instanceof Error ? error.message : String(error)
      if (!lastMismatch) lastMismatch = diagnostic
      mismatches.push({ attempt: attempts, message: diagnostic })
      if (lastObservation && terminalStates.has(lastObservation.hostState) && !expectedStates.includes(lastObservation.hostState)) {
        const terminalError = new Error(`等待三端观测提前终止（尝试 ${attempts} 次；${diagnostic}）`)
        terminalError.code = 'unexpected_terminal_state'
        terminalError.lastObservation = lastObservation
        terminalError.stability = {
          attempts,
          consecutiveStableReads: 0,
          lastMismatch,
          mismatches,
        }
        throw terminalError
      }
      // 只在一致性条件未满足时退避；退避随尝试次数增长，避免用固定等待掩盖落盘延迟。
      const delayMs = Math.min(1_000, 10 * (2 ** Math.min(attempts - 1, 7)))
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
  const timeoutError = new Error(`等待三端观测稳定超时（尝试 ${attempts} 次；${lastError instanceof Error ? lastError.message : String(lastError || '未知错误')}）`)
  timeoutError.code = 'observation_timeout'
  timeoutError.lastObservation = lastObservation
  timeoutError.stability = {
    attempts,
    consecutiveStableReads: 0,
    lastMismatch,
    mismatches,
  }
  throw timeoutError
}
