import type { ResultDelivery } from '@pawoffice/protocol/office-ui'

/** The caller supplies only the selected conversation's deliveries. Empty associations stay unlinked. */
export function deliveriesByTurn(deliveries: readonly ResultDelivery[]) {
  const turns = new Map<string, ResultDelivery[]>()
  for (const delivery of [...deliveries].sort((a, b) => a.sequence - b.sequence)) {
    if (!delivery.turnId) continue
    const group = turns.get(delivery.turnId) ?? []
    group.push(delivery)
    turns.set(delivery.turnId, group)
  }
  return turns
}
