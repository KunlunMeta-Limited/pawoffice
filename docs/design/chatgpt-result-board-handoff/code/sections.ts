import type { OfficeResult, ResultArtifact, ResultDocumentsSection, ResultSection } from '@pawoffice/protocol/office-ui'

export type ResultDocumentMetadata = ResultDocumentsSection['items'][number]

/** Associate metadata only through explicit artifact/version identity; titles are display text. */
export function resultDeliveryLayout(result: OfficeResult) {
  const documents = result.sections.flatMap(section => section.kind === 'documents' && !section.purpose ? section.items : [])
  const documentMeta = new Map<string, ResultDocumentMetadata>()
  const merged = new Set<ResultDocumentMetadata>()
  for (const artifact of result.artifacts) {
    const matches = documents.filter(item => item.artifactId === artifact.id && (!item.versionId || item.versionId === artifact.versionId))
    if (matches.length !== 1) continue
    if (artifact.kind === 'image') continue
    documentMeta.set(artifact.id, matches[0])
    merged.add(matches[0])
  }
  const sections = result.sections.flatMap<ResultSection>(section => {
    if (section.purpose) return [section]
    if (section.kind === 'files') {
      const items = section.items.filter(item => !item.artifactId || !result.artifacts.some(artifact => artifact.id === item.artifactId && (!item.versionId || artifact.versionId === item.versionId)))
      return items.length ? [{ ...section, items }] : []
    }
    if (section.kind !== 'documents') return [section]
    const items = section.items.filter(item => !merged.has(item))
    return items.length ? [{ ...section, items }] : []
  })
  return { sections, documentMeta }
}

/** Routing is semantic. Unclassified legacy content stays visible, without inventing its purpose. */
export function resultContentLayout(result: OfficeResult) {
  const { sections, documentMeta } = resultDeliveryLayout(result)
  const analysis: ResultSection[] = [], evidence: ResultSection[] = [], supplementary: ResultSection[] = [], previews: ResultSection[] = []
  const changes = sections.filter(section => section.kind === 'changes')
  for (const section of sections) {
    if (section.kind === 'changes') continue
    if (section.kind === 'tests') {
      // All checks are collected once, including stale-version handling, by resultEvidenceChecks.
      if (section.metrics.length || section.progress !== undefined) evidence.push({ ...section, checks: [] })
    } else if (section.purpose === 'artifact-preview') previews.push(section)
    else if (section.purpose === 'analysis') analysis.push(section)
    else if (section.purpose === 'evidence') evidence.push(section)
    else supplementary.push(section)
  }
  return { analysis, evidence, supplementary, previews, changes, documentMeta }
}

/** Pick only authored blocks for the exact selected file version, never by title. */
export function artifactPreviewSections(results: (OfficeResult | undefined)[], artifact: ResultArtifact) {
  for (const result of results) {
    if (!result) continue
    const sections = result.sections.filter(section => section.purpose === 'artifact-preview' && section.artifactId === artifact.id && section.versionId === artifact.versionId)
    if (sections.length) return sections
  }
  return []
}
