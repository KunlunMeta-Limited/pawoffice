import { useEffect, useRef } from 'react'
import { OFFICE_HTTP_ACTIONS_URL } from '@/config/officeMode'
import { setOfficeScenePaused } from '@/scene/officeSceneBridge'
import { OfficeActionHttpClient } from '@/services/officeActionHttp'

/** 轮询 HTTP 动作源；暂停时只冻结视觉消费，不篡改 Gateway 的真实业务状态。 */
export function OfficeActionConnector({ paused = false }: { paused?: boolean }) {
  const clientRef = useRef<OfficeActionHttpClient | null>(null)

  useEffect(() => {
    const client = new OfficeActionHttpClient()
    clientRef.current = client
    return () => {
      client.disconnect()
      clientRef.current = null
      setOfficeScenePaused(false)
    }
  }, [])

  useEffect(() => {
    setOfficeScenePaused(paused)
    const client = clientRef.current
    if (!client) return
    if (paused) client.disconnect()
    else client.connect(OFFICE_HTTP_ACTIONS_URL)
  }, [paused])

  return null
}
