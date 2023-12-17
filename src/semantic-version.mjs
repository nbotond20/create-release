export class SemanticVersion {
  /**
   * @param {number} major
   * @param {number} minor
   * @param {number} patch
   */

  constructor(major = 1, minor = 0, patch = 0) {
    this.major = major;
    this.minor = minor;
    this.patch = patch;
  }

  toString() {
    return `v${this.major}.${this.minor}.${this.patch}`;
  }
}
