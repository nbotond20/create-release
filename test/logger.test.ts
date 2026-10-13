import { describe, expect, it } from 'vitest'
import { describeError, redact } from '../src/logger.js'
import { githubError } from './helpers.js'

const createRelease = (status: number, data: Record<string, unknown>, headers: Record<string, string> = {}) =>
  describeError(githubError(status, 'POST', '/repos/acme/app/releases', data, headers)).join('\n')

describe('describeError (GitHub)', () => {
  it('explains a 404 when creating a release (the reported failure)', () => {
    const details = createRelease(404, { message: 'Not Found' }, { 'x-accepted-github-permissions': 'contents=write' })
    expect(details).toContain('GitHub API request failed: POST https://api.github.com/repos/acme/app/releases')
    expect(details).toContain('HTTP status: 404')
    expect(details).toContain('Request ID: ABCD:1234')
    expect(details).toContain('Permissions this endpoint accepts: contents=write')
    expect(details).toMatch(/cannot WRITE/)
    expect(details).toMatch(/env\.GITHUB_TOKEN/)
  })

  it('explains bad credentials and expired tokens', () => {
    const details = createRelease(
      401,
      { message: 'Bad credentials' },
      { 'github-authentication-token-expiration': '2020-01-01 00:00:00 UTC' }
    )
    expect(details).toMatch(/revoked or EXPIRED/)
    expect(details).toMatch(/Token expiration: 2020-01-01 00:00:00 UTC \(EXPIRED/)
  })

  it('explains missing workflow permissions', () => {
    expect(createRelease(403, { message: 'Resource not accessible by integration' })).toMatch(
      /permissions: contents: write/
    )
  })

  it('explains rate limits', () => {
    const details = createRelease(
      403,
      { message: 'API rate limit exceeded' },
      { 'x-ratelimit-remaining': '0', 'x-ratelimit-limit': '1000', 'x-ratelimit-reset': '1790000000' }
    )
    expect(details).toMatch(/rate limit exceeded; it resets at/)
    expect(details).toContain('Rate limit remaining: 0/1000')
  })

  it('explains SAML SSO enforcement', () => {
    expect(createRelease(403, { message: 'Forbidden' }, { 'x-github-sso': 'required; url=https://x' })).toMatch(
      /SAML SSO/
    )
  })

  it('explains an existing release', () => {
    const details = createRelease(422, {
      message: 'Validation Failed',
      errors: [{ resource: 'Release', code: 'already_exists', field: 'tag_name' }],
    })
    expect(details).toMatch(/already exists/)
    expect(details).toContain('GitHub validation errors:')
  })

  it('explains server errors', () => {
    expect(createRelease(502, { message: 'Bad Gateway' })).toMatch(/githubstatus/)
  })
})

describe('describeError robustness', () => {
  it('serializes null-prototype request bodies (as sent by Octokit)', () => {
    const body = Object.assign(Object.create(null), { tag_name: 'v1', target_commitish: 'abc' })
    const details = describeError(
      githubError(404, 'POST', '/repos/acme/app/releases', { message: 'Not Found' }, {}, body)
    )
    expect(details).toContain('Request body: {"tag_name":"v1","target_commitish":"abc"}')
  })
})

describe('redact', () => {
  it('hides GitHub and Slack tokens', () => {
    expect(redact('a ghp_abcdefghijklmnop b xoxb-123-456-abc c')).toBe('a [REDACTED] b [REDACTED] c')
  })
})
