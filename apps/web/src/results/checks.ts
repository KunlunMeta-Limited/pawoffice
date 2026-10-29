import type { OfficeResult } from '@pawoffice/protocol/office-ui'

/** Validation belongs to an exact revision, not to a filename or an earlier successful run. */
export function resultChecks(result: OfficeResult) {
  return result.checks.map(check => {
    const current = result.artifacts.find(artifact => artifact.id === check.artifactId)
    const stale = Boolean(check.versionId && (!current || current.versionId !== check.versionId))
    return { ...check, stale, status: stale ? 'pending' as const : check.status,
      label: stale ? `${check.label}（验证版本已更新，需重新验证）` : check.label }
  })
}
