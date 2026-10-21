import { describe, expect, it, vi } from 'vitest'
import {
  getArtifactShelfSnapshot,
  openArtifactShelf,
  registerArtifactShelfOpener,
  removeArtifactShelfSnapshot,
  setArtifactShelfSnapshot,
} from '@/services/artifactShelfStore'

describe('产物货架打开器', () => {
  it('同一空间的临时视图卸载后回退到仍存活的打开器', () => {
    const persistent = vi.fn()
    const temporary = vi.fn()
    const removePersistent = registerArtifactShelfOpener(persistent, 'session-a')
    const removeTemporary = registerArtifactShelfOpener(temporary, 'session-a')

    openArtifactShelf('session-a')
    expect(temporary).toHaveBeenCalledTimes(1)
    expect(persistent).not.toHaveBeenCalled()

    removeTemporary()
    openArtifactShelf('session-a')
    expect(persistent).toHaveBeenCalledTimes(1)
    removePersistent()
  })

  it('跳过仍未清理但对应 DOM 已失效的打开器', () => {
    const persistent = vi.fn()
    const stale = vi.fn()
    const removePersistent = registerArtifactShelfOpener(persistent, 'session-live', () => true)
    const removeStale = registerArtifactShelfOpener(stale, 'session-live', () => false)

    openArtifactShelf('session-live')
    expect(persistent).toHaveBeenCalledTimes(1)
    expect(stale).not.toHaveBeenCalled()

    removeStale()
    removePersistent()
  })

  it('临时 Dock 卸载不会清空同一空间的持久货架摘要', () => {
    const persistent = Symbol('persistent')
    const temporary = Symbol('temporary')
    setArtifactShelfSnapshot({ count: 2, pending: false, available: true }, 'session-b', persistent)
    setArtifactShelfSnapshot({ count: 2, pending: false, available: true }, 'session-b', temporary)
    removeArtifactShelfSnapshot('session-b', temporary)
    expect(getArtifactShelfSnapshot('session-b')).toEqual({ count: 2, pending: false, available: true })
    removeArtifactShelfSnapshot('session-b', persistent)
    expect(getArtifactShelfSnapshot('session-b')).toEqual({ count: 0, pending: false, available: false })
  })
})
