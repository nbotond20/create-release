import * as core from '@actions/core'
import { Octokit } from '@octokit/action'
import { RequestError } from '@octokit/request-error'
import { DetailedError, describeError, step, StepError } from './logger.js'
import { type Data, type SlackConfig, sendSlackReleaseNotes } from './send-slack-release-notes.js'
import { parseChannels, validateSlackToken, verifySlackToken } from './slack-api.js'
import { computeNextVersion, semverPattern, versionNumberPattern } from './version.js'

type Release = { id: number; name: string | null; tag_name: string; body?: string | null; html_url: string }

type Context = {
  octokit: InstanceType<typeof Octokit>
  owner: string
  repo: string
  sha: string | undefined
  createRelease: boolean
  useSemVer: boolean
  tag: string
  slackConfig: SlackConfig
}

/** Describes the kind of GitHub token from its prefix (never logs the token itself). */
function describeTokenType(token: string): string {
  if (token.startsWith('ghs_')) return 'GitHub Actions / GitHub App installation token (ghs_)'
  if (token.startsWith('ghp_')) return 'classic personal access token (ghp_)'
  if (token.startsWith('github_pat_')) return 'fine-grained personal access token (github_pat_)'
  if (token.startsWith('gho_')) return 'OAuth app token (gho_)'
  if (token.startsWith('ghu_')) return 'GitHub App user-to-server token (ghu_)'
  return 'unknown token format'
}

function getBooleanInput(name: string): boolean {
  try {
    return core.getBooleanInput(name)
  } catch {
    throw new DetailedError(`Input \`${name}\` must be a boolean`, [
      `Got: "${core.getInput(name)}"`,
      'Hint: use one of true | True | TRUE | false | False | FALSE.',
    ])
  }
}

function readContext(): Context {
  const repository = process.env.GITHUB_REPOSITORY ?? ''
  const [owner, repo] = repository.split('/')
  if (!owner || !repo) {
    throw new DetailedError('GITHUB_REPOSITORY is not set or malformed', [
      `GITHUB_REPOSITORY="${repository}"`,
      'Hint: this action must run inside GitHub Actions, which sets GITHUB_REPOSITORY to "owner/repo".',
    ])
  }

  // `env.GITHUB_TOKEN` wins for backwards compatibility; otherwise fall back to the `github-token` input.
  const envToken = process.env.GITHUB_TOKEN?.trim()
  const inputToken = core.getInput('github-token')
  const token = envToken || inputToken
  if (!token) {
    throw new DetailedError('No GitHub token available', [
      'Hint: pass `github-token: ${{ secrets.GITHUB_TOKEN }}` (default) or set `env: GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`.',
      'Hint: if you pass a custom secret, make sure it exists in this repository/environment and is not empty.',
    ])
  }
  core.setSecret(token)
  core.info(`GitHub token source: ${envToken ? 'env.GITHUB_TOKEN' : '`github-token` input'}`)
  core.info(`GitHub token type: ${describeTokenType(token)}`)
  if (envToken && inputToken && envToken !== inputToken) {
    core.info('Note: env.GITHUB_TOKEN is set and takes precedence over the `github-token` input.')
  }

  const slackToken = core.getInput('SLACK_BOT_TOKEN').trim()
  const slackConfig: SlackConfig = {
    title: core.getInput('title'),
    hideAuthors: getBooleanInput('hide-authors'),
    hidePRs: getBooleanInput('hide-prs'),
    hideFullChangeLogLink: getBooleanInput('hide-full-change-log-link'),
    hideTitle: getBooleanInput('hide-title'),
    addDivider: getBooleanInput('add-divider'),
    mergeItems: getBooleanInput('merge-items'),
    channels: core.getInput('channels'),
    repostChannels: core.getInput('repost-channels'),
    customChangelog: getBooleanInput('custom-github-changelog'),
    SLACK_BOT_TOKEN: slackToken,
    blocks: core.getInput('blocks'),
    groupId: core.getInput('group-id'),
  }

  const createRelease = getBooleanInput('create-release')
  const tag = core.getInput('tag').trim()

  if (tag && !versionNumberPattern.test(tag) && !semverPattern.test(tag)) {
    core.warning(
      `Input \`tag\` "${tag}" does not match "vYYMM.N" or "vX.Y.Z" and will be IGNORED; the version is computed automatically.`
    )
  }

  if (!createRelease && !slackToken) {
    throw new DetailedError('`create-release: false` requires `SLACK_BOT_TOKEN`', [
      'Hint: with create-release disabled the only thing this action does is post the latest release to Slack.',
    ])
  }

  if (slackToken && parseChannels(slackConfig.channels).length === 0) {
    throw new DetailedError('`SLACK_BOT_TOKEN` is set but `channels` is empty', [
      'Hint: set `channels` to one or more Slack channel IDs separated by `;` (e.g. `C0123456789`).',
    ])
  }

  const context: Context = {
    octokit: new Octokit({ auth: token, authStrategy: undefined }),
    owner,
    repo,
    sha: process.env.GITHUB_SHA,
    createRelease,
    useSemVer: getBooleanInput('use-sem-ver'),
    tag,
    slackConfig,
  }

  core.info(
    [
      `Repository:       ${owner}/${repo}`,
      `Event:            ${process.env.GITHUB_EVENT_NAME ?? '-'} on ${process.env.GITHUB_REF ?? '-'}`,
      `Commit (target):  ${context.sha ?? '(GITHUB_SHA not set - GitHub will use the default branch)'}`,
      `Actor:            ${process.env.GITHUB_ACTOR ?? '-'}`,
      `API URL:          ${process.env.GITHUB_API_URL ?? 'https://api.github.com'}`,
      `create-release:   ${createRelease}`,
      `use-sem-ver:      ${context.useSemVer}`,
      `tag:              ${tag || '(auto)'}`,
      `Slack:            ${slackToken ? `enabled → channels "${slackConfig.channels}"` : 'disabled (no SLACK_BOT_TOKEN)'}`,
      ...(slackToken
        ? [
            `  repost-channels: ${slackConfig.repostChannels || '-'}`,
            `  group-id:        ${slackConfig.groupId || '-'}`,
            `  custom blocks:   ${slackConfig.blocks ? 'yes' : 'no'}`,
            `  options:         title="${slackConfig.title ?? ''}" hide-authors=${slackConfig.hideAuthors} hide-prs=${slackConfig.hidePRs} hide-title=${slackConfig.hideTitle} hide-full-change-log-link=${slackConfig.hideFullChangeLogLink} add-divider=${slackConfig.addDivider} merge-items=${slackConfig.mergeItems} custom-github-changelog=${slackConfig.customChangelog}`,
          ]
        : []),
    ].join('\n')
  )

  return context
}

async function fetchLatestRelease({ octokit, owner, repo }: Context): Promise<Release | null> {
  core.info(`GET /repos/${owner}/${repo}/releases/latest`)
  try {
    const { data, headers } = await octokit.request('GET /repos/{owner}/{repo}/releases/latest', { owner, repo })
    core.info(
      `Latest release: name="${data.name}" tag="${data.tag_name}" id=${data.id} created=${data.created_at} (${data.html_url})`
    )
    core.debug(`Request ID: ${headers['x-github-request-id']}`)
    return data
  } catch (err) {
    if (err instanceof RequestError && err.status === 404) {
      core.info('No published release found (404). Drafts and pre-releases are not considered "latest".')
      return null
    }
    throw err
  }
}

/** Runs read-only checks after a failed release creation to pinpoint the cause. Never throws. */
async function diagnoseCreateReleaseFailure({ octokit, owner, repo, sha }: Context, tag: string): Promise<string[]> {
  const findings: string[] = ['Diagnostics:']
  const attempt = async (label: string, fn: () => Promise<string>) => {
    try {
      findings.push(`  ✔ ${label}: ${await fn()}`)
    } catch (err) {
      const status = err instanceof RequestError ? `HTTP ${err.status}` : String(err)
      findings.push(`  ✖ ${label}: ${status}`)
    }
  }

  await attempt('Repository visible to token', async () => {
    const { data } = await octokit.request('GET /repos/{owner}/{repo}', { owner, repo })
    const permissions = data.permissions
      ? Object.entries(data.permissions)
          .map(([key, value]) => `${key}=${value}`)
          .join(', ')
      : 'not reported for this token type'
    const canPush = data.permissions?.push === false ? ' ⚠ token CANNOT push → this is why the release failed' : ''
    return `${data.full_name} (${data.visibility}${data.archived ? ', ARCHIVED' : ''}); permissions: ${permissions}${canPush}`
  })

  await attempt(`Release for tag ${tag} already exists`, async () => {
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/releases/tags/{tag}', { owner, repo, tag })
    return `YES → ${data.html_url} (name "${data.name}")`
  })

  await attempt(`Git tag ${tag} exists`, async () => {
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
      owner,
      repo,
      ref: `tags/${tag}`,
    })
    return `YES → points to ${data.object.sha}`
  })

  if (sha) {
    await attempt(`Target commit ${sha.slice(0, 7)} exists`, async () => {
      const { data } = await octokit.request('GET /repos/{owner}/{repo}/commits/{ref}', { owner, repo, ref: sha })
      return `yes ("${data.commit.message.split('\n')[0]}")`
    })
  }

  return findings
}

async function createGitHubRelease(context: Context, tag: string): Promise<Release> {
  const { octokit, owner, repo, sha } = context
  core.info(`POST /repos/${owner}/${repo}/releases tag_name=${tag} target_commitish=${sha} generate_release_notes=true`)
  try {
    const { data } = await octokit.request('POST /repos/{owner}/{repo}/releases', {
      owner,
      repo,
      tag_name: tag,
      generate_release_notes: true,
      target_commitish: sha,
    })
    core.info(`Created release "${data.name}" (id ${data.id}): ${data.html_url}`)
    return data
  } catch (err) {
    core.info('Release creation failed, running diagnostics...')
    const diagnostics = await diagnoseCreateReleaseFailure(context, tag)
    throw new StepError('Create GitHub release', err, [...describeError(err), ...diagnostics])
  }
}

async function sendSlack(context: Context, release: Release | null, { releaseWasCreated = false } = {}) {
  const data: Data = { name: release?.name || release?.tag_name || '', body: release?.body ?? '' }
  try {
    await step('Send Slack release notes', () => sendSlackReleaseNotes(data, context.slackConfig))
  } catch (err) {
    if (releaseWasCreated && err instanceof StepError) {
      err.details.push(
        `Note: the GitHub release ${release?.html_url} WAS created. Re-running this workflow would create the NEXT version.`,
        'Note: to only resend the Slack message, run the action with `create-release: false`.'
      )
    }
    throw err
  }
}

export async function run() {
  const context = await step('Read inputs and environment', async () => readContext())

  if (context.slackConfig.SLACK_BOT_TOKEN) {
    await step('Verify Slack token', async () => {
      validateSlackToken(context.slackConfig.SLACK_BOT_TOKEN)
      await verifySlackToken(context.slackConfig.SLACK_BOT_TOKEN)
    })
  }

  const latestRelease = await step('Fetch latest release', () => fetchLatestRelease(context))

  if (!context.createRelease) {
    if (!latestRelease && !context.slackConfig.blocks) {
      throw new StepError(
        'Fetch latest release',
        new Error('You are trying to use the latest release but there is no release available.'),
        ['Hint: create a release first, set `create-release: true`, or provide custom `blocks`.']
      )
    }
    await sendSlack(context, latestRelease)
    if (latestRelease) core.setOutput('version', latestRelease.tag_name)
    core.info('Slack release notes sent for the latest release')
    return
  }

  const tag = await step('Compute next version', async () => {
    const previousName = latestRelease?.name || latestRelease?.tag_name
    if (latestRelease && !latestRelease.name) {
      core.info(`Latest release has no name, using its tag "${latestRelease.tag_name}" instead`)
    }

    const { version, matched } = computeNextVersion(previousName, context.useSemVer)
    if (!latestRelease) {
      core.info('No previous release found.')
    } else if (matched) {
      core.info(`Found previous version with valid name: ${previousName}`)
    } else {
      core.warning(
        `Last release name "${previousName}" does not match the ${context.useSemVer ? 'semver "vX.Y.Z"' : 'date "vYYMM.N"'} pattern; starting from ${version}.` +
          ` If you recently changed \`use-sem-ver\`, this is expected.`
      )
    }
    core.info(`Using ${version} as the next version`)

    const isValidTag = versionNumberPattern.test(context.tag) || semverPattern.test(context.tag)
    if (isValidTag) core.info(`Using the \`tag\` input "${context.tag}" instead of the computed version`)
    return isValidTag ? context.tag : version.toString()
  })

  const release = await step('Create GitHub release', () => createGitHubRelease(context, tag))
  core.setOutput('version', tag)
  core.setOutput('release-url', release.html_url)
  core.setOutput('release-id', release.id)

  if (context.slackConfig.SLACK_BOT_TOKEN) {
    await sendSlack(context, release, { releaseWasCreated: true })
  }

  await core.summary
    .addHeading(`✅ Released ${tag}`, 3)
    .addLink(release.html_url, release.html_url)
    .write()
    .catch(() => undefined)

  core.info('Release created')
}
