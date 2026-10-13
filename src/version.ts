import { SemanticVersion } from './semantic-version.js'

export const versionNumberPattern = /^v(\d{4})\.(\d+)$/
export const semverPattern = /^v(\d+)\.(\d+)\.(\d+)$/

export class Version {
  year: string
  month: string
  _revision?: number

  constructor(date: Date) {
    this.year = date.getFullYear().toString().substring(2)
    this.month = (date.getMonth() + 1).toString().padStart(2, '0')
  }

  get datePart() {
    return `${this.year}${this.month}`
  }

  set revision(value: number) {
    this._revision = value
  }

  toString() {
    return `v${this.datePart}.${this._revision ?? 1}`
  }
}

/**
 * Computes the next version from the latest release name.
 * - semver: bumps the patch (`v1.2.3` -> `v1.2.4`)
 * - date based: `vYYMM.N` -> `vYYMM.N+1` in the same month, otherwise `vYYMM.1`
 * Returns `matched: false` when the previous name doesn't match the pattern (a fresh version is used).
 */
export function computeNextVersion(
  previousName: string | null | undefined,
  useSemVer: boolean,
  now = new Date()
): { version: Version | SemanticVersion; matched: boolean } {
  const nextVersion = useSemVer ? new SemanticVersion() : new Version(now)
  const lastVersion = previousName ? (useSemVer ? semverPattern : versionNumberPattern).exec(previousName) : null

  if (!lastVersion) return { version: nextVersion, matched: false }

  if (nextVersion instanceof SemanticVersion) {
    nextVersion.major = parseInt(lastVersion[1], 10)
    nextVersion.minor = parseInt(lastVersion[2], 10)
    nextVersion.patch = parseInt(lastVersion[3], 10) + 1
  } else {
    nextVersion.revision = lastVersion[1] === nextVersion.datePart ? parseInt(lastVersion[2], 10) + 1 : 1
  }

  return { version: nextVersion, matched: true }
}
