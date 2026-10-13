import * as core from '@actions/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { githubError } from './helpers.js'
import { SECTIONED_BODY } from './fixtures.js'

const request = vi.fn()
vi.mock('@octokit/action', () => ({
  Octokit: class {
    request = request
  },
}))

vi.mock('@actions/core', async importOriginal => ({
  ...(await importOriginal<typeof import('@actions/core')>()),
  setFailed: vi.fn(),
  setOutput: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}))

const fetchMock = vi.fn()
const RELEASE = { id: 1, name: 'v2610.14', tag_name: 'v2610.14', body: SECTIONED_BODY, html_url: 'https://gh/r/1' }

function setInputs(inputs: Record<string, string>) {
  const defaults: Record<string, string> = {
    'hide-authors': 'false',
    'hide-prs': 'false',
    'hide-full-change-log-link': 'false',
    'hide-title': 'false',
    'add-divider': 'false',
    'use-sem-ver': 'false',
    'merge-items': 'false',
    'custom-github-changelog': 'false',
    'create-release': 'true',
    'github-token': 'ghs_workflowtoken',
  }
  for (const [name, value] of Object.entries({ ...defaults, ...inputs })) {
    vi.stubEnv(`INPUT_${name.replace(/ /g, '_').toUpperCase()}`, value)
  }
}

async function runAction() {
  const { run } = await import('../src/main.js')
  const { reportFailure } = await import('../src/logger.js')
  await run().catch(reportFailure)
}

const logs = () =>
  vi
    .mocked(core.info)
    .mock.calls.map(([line]) => line)
    .join('\n')

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 13))
  vi.stubEnv('GITHUB_REPOSITORY', 'acme/app')
  vi.stubEnv('GITHUB_SHA', 'abc1234def')
  vi.stubEnv('GITHUB_TOKEN', '')
  vi.stubEnv('GITHUB_STEP_SUMMARY', '')
  vi.stubGlobal('fetch', fetchMock)
  request.mockReset()
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ok: true, ts: '1', user: 'bot' })))
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('run', () => {
  it('creates the next date-based release and posts to Slack', async () => {
    setInputs({ SLACK_BOT_TOKEN: 'xoxb-1', channels: 'C1' })
    request.mockImplementation(async (route: string) => {
      if (route.startsWith('GET')) return { data: RELEASE, headers: {} }
      return { data: { ...RELEASE, id: 2, name: 'v2610.15', tag_name: 'v2610.15' }, headers: {} }
    })

    await runAction()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(request).toHaveBeenCalledWith('POST /repos/{owner}/{repo}/releases', {
      owner: 'acme',
      repo: 'app',
      tag_name: 'v2610.15',
      generate_release_notes: true,
      target_commitish: 'abc1234def',
    })
    expect(core.setOutput).toHaveBeenCalledWith('version', 'v2610.15')
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://slack.com/api/auth.test',
      'https://slack.com/api/chat.postMessage',
    ])
  })

  it('creates the first release when none exists', async () => {
    setInputs({ 'use-sem-ver': 'true' })
    request.mockImplementation(async (route: string) => {
      if (route.startsWith('GET'))
        throw githubError(404, 'GET', '/repos/acme/app/releases/latest', { message: 'Not Found' })
      return { data: { ...RELEASE, tag_name: 'v1.0.0' }, headers: {} }
    })

    await runAction()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(core.setOutput).toHaveBeenCalledWith('version', 'v1.0.0')
  })

  it('prints a failure report with diagnostics when creating the release returns 404', async () => {
    setInputs({})
    request.mockImplementation(async (route: string) => {
      if (route === 'GET /repos/{owner}/{repo}/releases/latest') return { data: RELEASE, headers: {} }
      if (route === 'POST /repos/{owner}/{repo}/releases') {
        throw githubError(404, 'POST', '/repos/acme/app/releases', { message: 'Not Found' })
      }
      if (route === 'GET /repos/{owner}/{repo}') {
        return {
          data: { full_name: 'acme/app', visibility: 'public', permissions: { pull: true, push: false } },
          headers: {},
        }
      }
      throw githubError(404, 'GET', '/whatever', { message: 'Not Found' })
    })

    await runAction()

    expect(core.setFailed).toHaveBeenCalledWith('Create GitHub release: Not Found')
    const output = logs()
    expect(output).toContain('Found previous version with valid name: v2610.14')
    expect(output).toContain('Using v2610.15 as the next version')
    expect(output).toContain('Failed step: Create GitHub release')
    expect(output).toContain('push=false ⚠ token CANNOT push')
    expect(output).toContain('✖ Release for tag v2610.15 already exists: HTTP 404')
    expect(output).toContain('GitHub token source: `github-token` input')
    expect(output).not.toContain('ghs_workflowtoken')
  })

  it('verifies the Slack token before creating a release', async () => {
    setInputs({ SLACK_BOT_TOKEN: 'xoxb-1', channels: 'C1' })
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: false, error: 'token_expired' })))

    await runAction()

    expect(core.setFailed).toHaveBeenCalledWith('Verify Slack token: Slack auth.test failed: token_expired')
    expect(request).not.toHaveBeenCalled()
  })

  it('tells the user the release exists when Slack fails afterwards', async () => {
    setInputs({ SLACK_BOT_TOKEN: 'xoxb-1', channels: 'C1' })
    request.mockResolvedValue({ data: RELEASE, headers: {} })
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: 'not_in_channel' })))

    await runAction()

    expect(core.setFailed).toHaveBeenCalledWith('Send Slack release notes: Failed to post to 1 of 1 Slack channel(s)')
    expect(logs()).toMatch(/\/invite @[\s\S]*WAS created/)
  })

  it('fails early on configuration errors', async () => {
    setInputs({ SLACK_BOT_TOKEN: 'xoxb-1', channels: ' ; ' })
    await runAction()
    expect(core.setFailed).toHaveBeenCalledWith(
      'Read inputs and environment: `SLACK_BOT_TOKEN` is set but `channels` is empty'
    )

    vi.mocked(core.setFailed).mockClear()
    setInputs({ 'hide-prs': 'yes' })
    await runAction()
    expect(core.setFailed).toHaveBeenCalledWith('Read inputs and environment: Input `hide-prs` must be a boolean')
  })

  it('only posts custom blocks when create-release is false and no release exists', async () => {
    setInputs({ 'create-release': 'false', SLACK_BOT_TOKEN: 'xoxb-1', channels: 'C1', blocks: '[{"type":"divider"}]' })
    request.mockRejectedValue(githubError(404, 'GET', '/repos/acme/app/releases/latest', { message: 'Not Found' }))

    await runAction()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(request).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('requires a release when create-release is false without blocks', async () => {
    setInputs({ 'create-release': 'false', SLACK_BOT_TOKEN: 'xoxb-1', channels: 'C1' })
    request.mockRejectedValue(githubError(404, 'GET', '/repos/acme/app/releases/latest', { message: 'Not Found' }))

    await runAction()

    expect(core.setFailed).toHaveBeenCalledWith(
      'Fetch latest release: You are trying to use the latest release but there is no release available.'
    )
  })
})
