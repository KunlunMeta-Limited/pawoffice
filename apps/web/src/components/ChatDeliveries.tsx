import { useState } from 'react'
import { ArrowUpRight, Files } from 'lucide-react'
import type { ResultDelivery } from '@pawoffice/protocol/office-ui'
import { formatResultTimestamp, resultStatusLabels } from '../results/format.ts'
import './ChatDeliveries.css'

export function ChatDeliveries({ deliveries, onOpen }: {
  deliveries: readonly ResultDelivery[]; onOpen?: (deliveryId: string) => boolean
}) {
  const [error, setError] = useState('')
  if (!deliveries.length) return null
  return <div className="chat-deliveries">
    <ul aria-label="本轮交付">
      {deliveries.map(delivery => {
        const title = delivery.title || `第 ${delivery.sequence} 次交付`
        return <li key={delivery.id}>
          <button type="button" className="chat-delivery-entry" aria-label={`查看交付：${title}`} aria-haspopup="dialog" disabled={!onOpen}
            onClick={() => { setError(onOpen?.(delivery.id) ? '' : '该交付暂时无法打开，请重新同步会话后重试。') }}>
            <span className="chat-delivery-icon" aria-hidden="true"><Files size={18} strokeWidth={1.7} /></span>
            <span className="chat-delivery-copy"><strong>{title}</strong>
              {delivery.result?.summary && <span className="chat-delivery-summary">{delivery.result.summary}</span>}
              <span className="chat-delivery-meta">
                <span data-status={delivery.result?.status}>{delivery.result ? resultStatusLabels[delivery.result.status] : '历史交付'}</span>
                <span>{delivery.result ? `${delivery.result.artifacts.length} 项产物` : '产物详情待查看'}</span>
                <time dateTime={delivery.createdAt} title="交付时间（本地时区）">{formatResultTimestamp(delivery.createdAt)}</time>
              </span>
            </span>
            <ArrowUpRight className="chat-delivery-arrow" size={16} aria-hidden="true" />
          </button>
        </li>
      })}
    </ul>
    {!onOpen && <p className="chat-delivery-error">当前界面暂不支持打开成果。</p>}
    {error && <p className="chat-delivery-error" role="alert">{error}</p>}
  </div>
}
