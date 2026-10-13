import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendSlackReleaseNotes, type SlackConfig } from '../src/send-slack-release-notes.js'
import { PLAIN_BODY, SECTIONED_BODY } from './fixtures.js'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ok: true, ts: '1.2' }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const sentPayloads = () => fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string))

const base: SlackConfig = { channels: 'releases', SLACK_BOT_TOKEN: 'xoxb-test' }

const cases: Array<[string, string, Partial<SlackConfig>]> = [
  ['plain body, defaults', PLAIN_BODY, {}],
  ['plain body, hide authors + PRs', PLAIN_BODY, { hideAuthors: true, hidePRs: true }],
  [
    'plain body, custom title + hidden link',
    PLAIN_BODY,
    { title: 'Release $release_name', hideFullChangeLogLink: true },
  ],
  ['plain body, hidden title + group id', PLAIN_BODY, { hideTitle: true, groupId: 'S123' }],
  ['sectioned body, defaults', SECTIONED_BODY, {}],
  ['sectioned body, dividers', SECTIONED_BODY, { addDivider: true }],
  ['sectioned body, merge items', SECTIONED_BODY, { mergeItems: true }],
  ['sectioned body, repost channels', SECTIONED_BODY, { repostChannels: 'general;team', groupId: 'S123' }],
  ['custom changelog', '*Hand written* notes', { customChangelog: true, title: 'Notes for $release_name' }],
  ['custom blocks with title', '', { blocks: '[{"type":"divider"}]', title: 'Heads up' }],
  ['custom blocks without title', '', { blocks: '[{"type":"divider"}]' }],
]

describe('sendSlackReleaseNotes payloads', () => {
  it.each(cases)('%s', async (_name, body, config) => {
    await sendSlackReleaseNotes({ name: 'v1.0.1', body }, { ...base, ...config })
    expect(sentPayloads()).toMatchSnapshot()
  })

  it('posts to every channel', async () => {
    await sendSlackReleaseNotes({ name: 'v1.0.1', body: PLAIN_BODY }, { ...base, channels: 'a;b;c' })
    expect(sentPayloads().map(p => p.channel)).toEqual(['a', 'b', 'c'])
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer xoxb-test')
  })
})
