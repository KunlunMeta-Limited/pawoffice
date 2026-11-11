import type { OfficeResult, ResultArtifact, ResultCheck, ResultDocumentsSection, ResultSection } from '@pawoffice/protocol/office-ui'
import { resultChecks } from './checks.ts'

export type ResultDocumentMetadata = ResultDocumentsSection['items'][number]
export type ResultAnnotatedCheck = ReturnType<typeof resultChecks>[number]

/** Checks for one result, with old-version bindings already resolved by the existing reader rule. */
export function resultBoardChecks(result: OfficeResult) {
  return resultChecks(result)
}

const checkKey = (check: Pick<ResultCheck, 'id' | 'artifactId' | 'versionId'>) => JSON.stringify([check.id, check.artifactId, check.versionId])

/**
 * Display groups derived from the existing stale-version rule. `passed` never includes a check whose
 * evidence was bound to an older artifact version; those stay in `stale` and read as 待补充验证.
 */
export function resultCheckSummary(checks: readonly ResultAnnotatedCheck[]) {
  const fresh = checks.filter(check => !check.stale)
  return {
    total: checks.length,
    passed: fresh.filter(check => check.status === 'passed').length,
    pending: fresh.filter(check => check.status === 'pending').length,
    failed: fresh.filter(check => check.status === 'failed').length,
    stale: checks.filter(check => check.stale).length,
  }
}

/** The current artifact version a stale check was originally bound to, for an honest explanation. */
export function resultStaleCheckDetail(result: OfficeResult, check: ResultAnnotatedCheck) {
  if (!check.stale) return ''
  const current = result.artifacts.find(artifact => artifact.id === check.artifactId)
  const bound = check.versionId || '未标注版本'
  if (!current) return `原验证版本 ${bound} 已不在本轮交付中`
  return `原验证版本 ${bound}，当前版本 ${current.version || current.versionId || '未标注版本'}`
}

/**
 * Metadata for one artifact, only through explicit artifactId + versionId identity.
 * Titles are display text; a similar title never creates a link.
 */
export function resultDocumentMetadata(result: OfficeResult) {
  const metadata = new Map<string, ResultDocumentMetadata>()
  const documents = result.sections.flatMap(section => section.kind === 'documents' && !section.purpose ? section.items : [])
  for (const artifact of result.artifacts) {
    const matches = documents.filter(item => item.artifactId === artifact.id
      && (!item.versionId || item.versionId === artifact.versionId))
    if (matches.length === 1) metadata.set(artifact.id, matches[0])
  }
  return metadata
}

/** The artifact a section points at through its exact routing identity, never by title. */
export function resultSectionArtifact(result: OfficeResult, section: ResultSection) {
  if (!section.artifactId) return undefined
  return result.artifacts.find(artifact => artifact.id === section.artifactId && artifact.versionId === section.versionId)
}

/**
 * Every section stays in the source order from the contract. Only display data changes:
 * the top-level check panel and a `tests` section never show the same check twice.
 */
export function resultBoardSections(result: OfficeResult) {
  const topLevel = new Set(result.checks.map(checkKey))
  return result.sections.map<ResultSection>(section => {
    if (section.kind !== 'tests') return section
    const own = section.checks.filter(check => !topLevel.has(checkKey(check)))
    if (own.length === section.checks.length) return section
    if (!own.length) return { ...section, checks: [] }
    // Keep the exact backend check fields; only the reader's stale-version label/status is display-only.
    return { ...section, checks: resultChecks({ ...result, checks: own }).map(check => ({
      id: check.id, label: check.label, status: check.status, artifactId: check.artifactId, versionId: check.versionId,
    })) }
  })
}

/** A changed-file count for the delivery summary, without inventing extra metrics. */
export function resultChangedFileCount(result: OfficeResult) {
  return result.sections.reduce((count, section) => count + (section.kind === 'changes' ? section.files.length : 0), 0)
}

export function resultArtifactVersionLabel(artifact: ResultArtifact) {
  return artifact.version || artifact.versionId
}
