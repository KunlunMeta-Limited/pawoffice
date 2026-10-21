/**
 * 功能：封装 Office Gateway 资源的加载、刷新、错误和取消生命周期。
 * 设计约束：组件卸载或依赖变化时必须中止上一请求；被中止请求不得覆盖新状态。
 * 关联：`DAT-OFFICE-RESOURCE-001`、`REQ-B-OFFICE-005`、`CHG-2026-0004`。
 */
import { useEffect, useRef, useState } from 'react'
import type { OfficeResourceState } from '@/types/officeData'

/**
 * 功能：描述一个 Office 资源的当前数据和请求状态。
 * 字段/变体语义：`data` 是最近成功值，`state` 是读取阶段，`error` 是最近非取消异常。
 * 数据来源：`useOfficeResource` 的 loader；数据去向：面板组件渲染。
 * 约束：`state=error` 时 `error` 应包含原因；`state=ready` 时 `data` 为最近成功结果。
 * 稳定性：跨组件公共 Hook 返回契约。
 * 关联：`DAT-OFFICE-RESOURCE-001`。
 */
/** 公共返回类型：资源数据、状态和错误组成一个不可变观察快照。 */
export interface OfficeResource<T> {
  /** 最近一次成功数据或禁用时的初始数据。 */
  data: T
  /** 当前加载状态。 */
  state: OfficeResourceState
  /** 最近一次非取消错误；无错误时为 `null`。 */
  error: Error | null
}

/**
 * 功能：加载并持续刷新一个 Office Gateway 资源。
 * 参数：`loader` 接收本次请求的 `AbortSignal`；`initial` 为初始数据；`enabled` 控制是否请求；
 * `refreshKey` 变化时重新加载。
 * 返回：包含 `data`、`state` 和 `error` 的资源对象。
 * 错误：首次请求的非取消异常进入 `error` 状态；后台刷新失败保留最近成功数据，
 * 同时保留错误信息供面板显示连接降级提示。
 * 状态：首次启用按 idle/loading/ready/error 转换；后续刷新采用 stale-while-refresh；禁用时回到 idle 并恢复初始数据。
 * 并发与取消：依赖变化和卸载会调用 `AbortController.abort()`，旧请求不能覆盖新请求。
 * 权限：Hook 不增加请求权限，loader 必须使用已登记的 Gateway API。
 * 关联：`API-OFFICE-GATEWAY-001`、`REQ-B-OFFICE-005`。
 */
/** 公共 Hook：加载资源并在卸载或刷新时取消上一请求。 */
export function useOfficeResource<T>(loader: (signal: AbortSignal) => Promise<T>, initial: T, enabled = true, refreshKey?: string | number): OfficeResource<T> {
  const [data, setData] = useState(initial)
  const initialRef = useRef(initial)
  const [state, setState] = useState<OfficeResourceState>('loading')
  const [error, setError] = useState<Error | null>(null)
  const hasResolvedRef = useRef(false)

  useEffect(() => {
    if (!enabled) {
      hasResolvedRef.current = false
      setState('idle')
      setData(initialRef.current)
      setError(null)
      return
    }
    const controller = new AbortController()
    // 首次加载失败进入 error；一旦有过成功结果，后续后台刷新失败保留旧 data 和
    // ready 状态，只更新 error，避免首页和面板周期性回到 loading 造成抖动。
    if (!hasResolvedRef.current) {
      setState('loading')
      setError(null)
    }
    void loader(controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return
        hasResolvedRef.current = true
        setData(next)
        setState('ready')
        setError(null)
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        if (!hasResolvedRef.current) setState('error')
        setError(reason instanceof Error ? reason : new Error('办公室网关请求失败'))
      })
    return () => controller.abort()
  }, [loader, enabled, refreshKey])

  return { data, state, error }
}
