import * as core from '@actions/core'
import { Octokit } from '@octokit/action'
import { Version } from './version'
import { SemanticVersion } from './semantic-version'
import { Data, SlackConfig, sendSlackReleaseNotes } from './send-slack-release-notes.js'

const versionNumberPattern = /^v(\d{4})\.(\d+)$/
const semverPattern = /^v(\d+)\.(\d+)\.(\d+)$/

const octokit = new Octokit()
const [owner, repo] = process.env.GITHUB_REPOSITORY!.split('/')

async function createRelease(version: Version | SemanticVersion, slackConfig: SlackConfig) {
  // eslint-disable-next-line no-console
  console.log(`Using ${version} as the next version`)

  if (!process.env.GITHUB_TOKEN) {
    throw new Error('GITHUB_TOKEN is not set')
  }

  if (!owner || !repo) {
    throw new Error('GITHUB_REPOSITORY is not set')
  }

  const tag = core.getInput('tag')
  const isValidTag = versionNumberPattern.test(tag) || semverPattern.test(tag)

  const { data } = await octokit.request('POST /repos/{owner}/{repo}/releases', {
    owner,
    repo,
    tag_name: isValidTag ? tag : version.toString(),
    generate_release_notes: true,
    target_commitish: process.env.GITHUB_SHA,
  })

  await sendSlackReleaseNotes(data as Data, slackConfig)

  core.setOutput('version', isValidTag ? tag : version.toString())
}

async function run() {
  const createReleaseOption = core.getBooleanInput('create-release')
  const SLACK_BOT_TOKEN = core.getInput('SLACK_BOT_TOKEN')

  const slackConfig = {
    title: core.getInput('title'),
    hideAuthors: core.getBooleanInput('hide-authors'),
    hidePRs: core.getBooleanInput('hide-prs'),
    hideFullChangeLogLink: core.getBooleanInput('hide-full-change-log-link'),
    hideTitle: core.getBooleanInput('hide-title'),
    addDivider: core.getBooleanInput('add-divider'),
    mergeItems: core.getBooleanInput('merge-items'),
    channel: core.getInput('channel'),
    repostChannels: core.getInput('repost-channels'),
    customChangelog: core.getBooleanInput('custom-github-changelog'),
    SLACK_BOT_TOKEN,
    blocks: core.getInput('blocks'),
  }

  let release
  try {
    const response = await octokit.request('GET /repos/{owner}/{repo}/releases/latest', { owner, repo })
    release = response.data

    if (!createReleaseOption) {
      await sendSlackReleaseNotes(response.data as Data, slackConfig)
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    if (!createReleaseOption && !slackConfig.blocks) {
      throw new Error('You are trying use the latest release but there is no release available.')
    }

    if (err.message !== 'Not Found') {
      throw err
    }
  }

  const useSemVer = core.getInput('use-sem-ver') === 'true'

  const nextVersion = useSemVer ? new SemanticVersion() : new Version(new Date())

  if (!release) {
    // eslint-disable-next-line no-console
    console.log('No previous release found.')
    await createRelease(nextVersion, slackConfig)
    return
  }

  const lastVersion = useSemVer ? semverPattern.exec(release.name!) : versionNumberPattern.exec(release.name!)

  if (lastVersion) {
    // eslint-disable-next-line no-console
    console.log(`Found previous version with valid name: ${lastVersion[0]}`)

    if (useSemVer) {
      ;(nextVersion as SemanticVersion).major = parseInt(lastVersion[1], 10)
      ;(nextVersion as SemanticVersion).minor = parseInt(lastVersion[2], 10)
      ;(nextVersion as SemanticVersion).patch = parseInt(lastVersion[3], 10) + 1
    } else {
      ;(nextVersion as Version).revision =
        lastVersion[1] === (nextVersion as Version).datePart ? parseInt(lastVersion[2], 10) + 1 : 1
    }
  } else {
    // eslint-disable-next-line no-console
    console.warn('Last version number does not match the pattern')
  }

  await createRelease(nextVersion, slackConfig)
}

run()
  .then(() => {
    // eslint-disable-next-line no-console
    console.log('Release created')
  })
  .catch(err => {
    core.setFailed(`There was a problem: ${err.message}\n${err.stack}`)
  })
