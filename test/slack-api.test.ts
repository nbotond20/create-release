import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DetailedError } from '../src/logger.js'
import { buildSlackMessage, parseCustomBlocks } from '../src/send-slack-release-notes.js'
import {
  findBlockProblems,
  parseChannels,
  postSlackMessages,
  validateSlackToken,
  verifySlackToken,
} from '../src/slack-api.js'
import { PLAIN_BODY } from './fixtures.js'

const fetchMock = vi.fn()
const json = (body: object, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers })

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const message = (channel: string) => ({ channel, text: 'hi', blocks: [] })

async function expectDetailedError(promise: Promise<unknown>): Promise<DetailedError> {
  const settled = promise.then(
    () => {
      throw new Error('expected promise to reject')
    },
    err => err
  )
  await vi.runAllTimersAsync()
  const err = await settled
  expect(err).toBeInstanceOf(DetailedError)
  return err as DetailedError
}

describe('postSlackMessages errors', () => {
  it.each([
    ['not_in_channel', /\/invite @/],
    ['channel_not_found', /channel ID/],
    ['is_archived', /archived/],
    ['invalid_auth', /invalid/],
    ['token_expired', /EXPIRED/],
    ['token_revoked', /REVOKED/],
    ['account_inactive', /deactivated/],
    ['not_allowed_token_type', /xoxb-/],
    ['msg_too_long', /too long/],
    ['restricted_action_read_only_channel', /read-only/],
    ['some_brand_new_error', /api\.slack\.com\/methods\/chat\.postMessage#errors/],
  ])('explains %s', async (error, hint) => {
    fetchMock.mockResolvedValue(json({ ok: false, error }))
    const err = await expectDetailedError(postSlackMessages('xoxb-1', ['C1'], message))
    const details = err.details.join('\n')
    expect(details).toContain(`Slack error code: ${error}`)
    expect(details).toContain('Channel: C1')
    expect(details).toMatch(hint)
  })

  it('reports needed and provided scopes for missing_scope', async () => {
    fetchMock.mockResolvedValue(
      json({ ok: false, error: 'missing_scope', needed: 'chat:write', provided: 'users:read' })
    )
    const err = await expectDetailedError(postSlackMessages('xoxb-1', ['C1'], message))
    expect(err.details).toContain('Scope needed: chat:write')
    expect(err.details).toContain('Scopes the token has: users:read')
    expect(err.details.join('\n')).toMatch(/REINSTALL/)
  })

  it('includes Slack validation messages for invalid_blocks', async () => {
    fetchMock.mockResolvedValue(
      json({ ok: false, error: 'invalid_blocks', response_metadata: { messages: ['[ERROR] must be less than 3001'] } })
    )
    const err = await expectDetailedError(postSlackMessages('xoxb-1', ['C1'], message))
    expect(err.details.join('\n')).toContain('Slack messages: [ERROR] must be less than 3001')
  })

  it('tries every channel and aggregates failures', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ ok: false, error: 'not_in_channel' }))
      .mockResolvedValueOnce(json({ ok: true, ts: '1' }))
      .mockResolvedValueOnce(json({ ok: false, error: 'channel_not_found' }))
    const err = await expectDetailedError(postSlackMessages('xoxb-1', ['A', 'B', 'C'], message))
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(err.message).toBe('Failed to post to 2 of 3 Slack channel(s)')
    expect(err.details.join('\n')).toMatch(/Channel: A[\s\S]*not_in_channel[\s\S]*Channel: C[\s\S]*channel_not_found/)
  })

  it('retries on HTTP 429 using Retry-After', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '1' } }))
      .mockResolvedValueOnce(json({ ok: true, ts: '1' }))
    const promise = postSlackMessages('xoxb-1', ['C1'], message)
    await vi.runAllTimersAsync()
    await promise
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('gives up after repeated 5xx errors', async () => {
    fetchMock.mockImplementation(async () => new Response('<html>oops</html>', { status: 503 }))
    const err = await expectDetailedError(postSlackMessages('xoxb-1', ['C1'], message))
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(err.details.join('\n')).toMatch(/non-JSON response \(HTTP 503\)[\s\S]*slack-status/)
  })

  it('reports network errors with their code', async () => {
    fetchMock.mockRejectedValue(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }))
    const err = await expectDetailedError(postSlackMessages('xoxb-1', ['C1'], message))
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(err.details.join('\n')).toContain('Network error code: ENOTFOUND')
  })

  it('fails when no channels are configured', async () => {
    const err = await expectDetailedError(postSlackMessages('xoxb-1', [], message))
    expect(err.message).toBe('No Slack channels configured')
  })
})

describe('verifySlackToken', () => {
  it('fails with a hint for an expired token', async () => {
    fetchMock.mockResolvedValue(json({ ok: false, error: 'token_expired' }))
    const err = await expectDetailedError(verifySlackToken('xoxb-1'))
    expect(err.message).toBe('Slack auth.test failed: token_expired')
  })

  it('passes for a valid token', async () => {
    fetchMock.mockResolvedValue(json({ ok: true, user: 'release-bot', team: 'Acme', bot_id: 'B1' }))
    await expect(verifySlackToken('xoxb-1')).resolves.toBeUndefined()
  })
})

describe('validateSlackToken', () => {
  it('rejects webhook URLs and app-level tokens', () => {
    expect(() => validateSlackToken('https://hooks.slack.com/services/x')).toThrow(/Incoming Webhook URL/)
    expect(() => validateSlackToken('xapp-1-abc')).toThrow(/app-level token/)
  })

  it('accepts bot tokens', () => {
    expect(() => validateSlackToken('xoxb-123')).not.toThrow()
  })
})

describe('helpers', () => {
  it('parses channels leniently', () => {
    expect(parseChannels(' a; b ;;c; ')).toEqual(['a', 'b', 'c'])
  })

  it('flags messages that exceed Slack limits', () => {
    const problems = findBlockProblems({
      channel: 'C1',
      text: 'x',
      blocks: [
        { type: 'header', text: { text: 'h'.repeat(151) } },
        { type: 'section', text: { text: 's'.repeat(3001) } },
        ...Array.from({ length: 49 }, () => ({ type: 'divider' })),
      ],
    })
    expect(problems).toHaveLength(3)
  })

  it('explains invalid custom blocks', () => {
    expect(() => parseCustomBlocks('[{"type":"divider",}]')).toThrow(/Failed to parse the `blocks` input as JSON/)
    expect(() => parseCustomBlocks('{"type":"divider"}')).toThrow(/must be a JSON array/)
    expect(() => parseCustomBlocks('[{"text":"x"}]')).toThrow(/Block #0 .* missing a "type"/)
  })

  it('handles a body without the triple-newline before the changelog link', () => {
    const body = PLAIN_BODY.replace(/## New Contributors[\s\S]*?\n\n\n/, '\n')
    const { blocks } = buildSlackMessage({ name: 'v1', body }, { channels: 'C1', SLACK_BOT_TOKEN: 'x' })
    expect(JSON.stringify(blocks.at(-1))).toContain('<https://github.com/acme/app/compare/v1.0.0...v1.0.1|')
    expect(JSON.stringify(blocks[1])).not.toContain('Full Changelog')
  })
})
