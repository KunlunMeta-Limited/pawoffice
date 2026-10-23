import { officeIntegrationPaths, officeUiPresentationSchema } from '@pawoffice/protocol/office-integration'
import type { OfficeUiAction } from '@pawoffice/protocol/office-integration'
import { responseEnvelopeSchema, stringifyProtocolObject } from '@pawoffice/protocol/schema'

export async function requestOfficeUi(baseUrl: string, action: OfficeUiAction) {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}${officeIntegrationPaths.ui}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: stringifyProtocolObject(action), signal: AbortSignal.timeout(65000) })
  const result = responseEnvelopeSchema.parse(await response.json())
  if (result.code !== response.status) throw new Error('用户操作响应格式错误')
  if (!response.ok) throw new Error(response.status === 408 && action.action === 'office.create'
    ? '创建超时，请确认工作空间服务已连接后重试。' : `${result.msg}（${result.data?.reasonCode ?? response.status}）`)
  return officeUiPresentationSchema.parse(result.data)
}
