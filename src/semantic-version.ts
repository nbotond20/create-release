export class SemanticVersion {
  major: number
  minor: number
  patch: number

  constructor(major = 1, minor = 0, patch = 0) {
    this.major = major
    this.minor = minor
    this.patch = patch
  }

  toString() {
    return `v${this.major}.${this.minor}.${this.patch}`
  }
}
