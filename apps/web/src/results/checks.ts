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

export function resultVerificationConflict(result: OfficeResult) {
  return result.status === 'verified' && resultEvidenceChecks(result).some(check => check.status !== 'passed')
}

/** One evidence list; duplicated legacy section checks never turn into a second acceptance panel. */
export function resultEvidenceCheckInputs(result: OfficeResult) {
  const checks = new Map<string, OfficeResult['checks'][number]>()
  const priority = { failed: 0, pending: 1, passed: 2 }
  for (const check of [...result.checks, ...result.sections.flatMap(section => section.kind === 'tests' ? section.checks : [])]) {
    const key = JSON.stringify([check.id, check.artifactId, check.versionId])
    const previous = checks.get(key)
    if (!previous || priority[check.status] < priority[previous.status]) checks.set(key, check)
  }
  return [...checks.values()]
}

export function resultEvidenceChecks(result: OfficeResult) {
  return resultChecks({ ...result, checks: resultEvidenceCheckInputs(result) })
}
