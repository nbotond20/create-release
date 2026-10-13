import { describe, expect, it } from 'vitest'
import { computeNextVersion } from '../src/version.js'

const oct2026 = new Date(2026, 9, 13)

describe('computeNextVersion', () => {
  it.each([
    ['v2610.14', false, 'v2610.15', true],
    ['v2609.7', false, 'v2610.1', true],
    [null, false, 'v2610.1', false],
    ['Release 1', false, 'v2610.1', false],
    ['v1.2.3', true, 'v1.2.4', true],
    ['v2610.14', true, 'v1.0.0', false],
    [undefined, true, 'v1.0.0', false],
  ] as const)('%s (semver=%s) -> %s', (previous, semver, expected, matched) => {
    const result = computeNextVersion(previous, semver, oct2026)
    expect(result.version.toString()).toBe(expected)
    expect(result.matched).toBe(matched)
  })
})
