import * as core from '@actions/core'
import { RequestError } from '@octokit/request-error'

/**
 * An error that remembers which step failed and carries extra context lines
 * (request details, hints, diagnostics) that are printed when the action fails.
 */
export class StepError extends Error {
  readonly step: string
  readonly details: string[]

  constructor(step: string, cause: unknown, details: string[] = []) {
    super(cause instanceof Error ? cause.message : String(cause), { cause })
    this.name = 'StepError'
    this.step = step
    this.details = details
  }
}

/** An error with additional, human-readable context lines. */
export class DetailedError extends Error {
  readonly details: string[]

  constructor(message: string, details: string[] = []) {
    super(message)
    this.name = 'DetailedError'
    this.details = details
  }
}

/**
 * Runs `fn` inside a collapsible log group, logs how long it took and,
 * if it throws, re-throws a `StepError` describing exactly where it failed.
 */
export async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const startedAt = Date.now()
  core.startGroup(`▶ ${name}`)
  try {
    const result = await fn()
    core.info(`✔ ${name} (${Date.now() - startedAt}ms)`)
    return result
  } catch (err) {
    core.info(`✖ ${name} failed after ${Date.now() - startedAt}ms`)
    if (err instanceof StepError) throw err
    throw new StepError(name, err, describeError(err))
  } finally {
    core.endGroup()
  }
}

/** Builds a list of context lines for any error, with extra detail for GitHub API errors. */
export function describeError(err: unknown): string[] {
  try {
    if (err instanceof RequestError) return describeRequestError(err)
    if (err instanceof DetailedError) return err.details
    return []
  } catch (describeErr) {
    // Never let the error description hide the original error
    return [`(Could not describe the error in detail: ${(describeErr as Error)?.message ?? describeErr})`]
  }
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return '(unserializable)'
  }
}

function describeRequestError(err: RequestError): string[] {
  const headers = err.response?.headers ?? {}
  const data = err.response?.data as
    { message?: string; documentation_url?: string; errors?: unknown[]; status?: string } | undefined

  const lines = [
    `GitHub API request failed: ${err.request.method} ${err.request.url}`,
    `HTTP status: ${err.status}`,
    `GitHub message: ${data?.message ?? err.message}`,
  ]

  if (data?.errors?.length) lines.push(`GitHub validation errors: ${JSON.stringify(data.errors)}`)
  if (data?.documentation_url) lines.push(`Docs: ${data.documentation_url}`)
  if (headers['x-github-request-id']) lines.push(`Request ID: ${headers['x-github-request-id']}`)
  if (headers['x-accepted-github-permissions'] !== undefined) {
    lines.push(`Permissions this endpoint accepts: ${headers['x-accepted-github-permissions'] || '(none reported)'}`)
  }
  if (headers['x-oauth-scopes'] !== undefined) {
    lines.push(`Token OAuth scopes: ${headers['x-oauth-scopes'] || '(none)'}`)
  }
  if (headers['x-ratelimit-remaining'] !== undefined) {
    lines.push(`Rate limit remaining: ${headers['x-ratelimit-remaining']}/${headers['x-ratelimit-limit']}`)
  }
  if (err.request.body) lines.push(`Request body: ${redact(stringify(err.request.body))}`)

  return [...lines, ...hintsFor(err)]
}

function hintsFor(err: RequestError): string[] {
  const headers = err.response?.headers ?? {}
  const message = String((err.response?.data as { message?: string } | undefined)?.message ?? err.message)
  const isCreateRelease = err.request.method === 'POST' && /\/releases$/.test(err.request.url)
  const hints: string[] = []

  const tokenExpiry = headers['github-authentication-token-expiration']
  if (tokenExpiry) {
    const expired = new Date(String(tokenExpiry)).getTime() < Date.now()
    hints.push(
      `Token expiration: ${tokenExpiry}${expired ? ' (EXPIRED - generate a new token and update the secret)' : ''}`
    )
  }

  if (err.status === 0 || (err.status === 500 && !err.response)) {
    const cause = err.cause as { code?: string; message?: string } | undefined
    return [
      ...hints,
      `Hint: the request never got a response from GitHub (network error${cause?.code ? `: ${cause.code}` : ''}${cause?.message ? ` - ${cause.message}` : ''}).`,
      'Hint: check runner connectivity, proxy settings (HTTP_PROXY/HTTPS_PROXY) and GITHUB_API_URL. Re-running usually helps.',
    ]
  }

  if (headers['x-github-sso']) {
    hints.push(
      `Hint: the organization enforces SAML SSO and this token is not authorized for it (${headers['x-github-sso']}).`,
      'Hint: open GitHub → Settings → Developer settings → Tokens → "Configure SSO" and authorize the token for the org.'
    )
  }

  switch (err.status) {
    case 401:
      hints.push(
        /bad credentials/i.test(message)
          ? 'Hint: "Bad credentials" means the token is wrong, revoked or EXPIRED. Generate a new token and update the secret.'
          : 'Hint: the request was not authenticated. Check that the token secret exists and is not empty.',
        'Hint: if you pass a PAT through `env.GITHUB_TOKEN`, it overrides the built-in workflow token.'
      )
      break
    case 403:
      if (headers['x-ratelimit-remaining'] === '0' || /rate limit/i.test(message)) {
        const reset = Number(headers['x-ratelimit-reset'])
        hints.push(
          `Hint: GitHub API rate limit exceeded${reset ? `; it resets at ${new Date(reset * 1000).toISOString()}` : ''}.`
        )
      } else if (/resource not accessible by integration/i.test(message)) {
        hints.push(
          'Hint: "Resource not accessible by integration" = the workflow token lacks the needed permission.',
          isCreateRelease
            ? 'Hint: add `permissions: contents: write` to the job, or allow "Read and write permissions" in Settings → Actions → General → Workflow permissions.'
            : 'Hint: check the job `permissions:` block (see "Permissions this endpoint accepts" above).',
          'Hint: runs triggered by pull requests from forks always get a read-only token.'
        )
      } else {
        hints.push(
          'Hint: the token is valid but is not allowed to do this.',
          isCreateRelease
            ? 'Hint: the token needs "Contents: write" (`permissions: contents: write`, classic PAT `repo` scope, or GitHub App "Contents: Read & write").'
            : 'Hint: check the job `permissions:` block and the token scopes above.'
        )
      }
      break
    case 404:
      hints.push(
        ...(isCreateRelease
          ? [
              'Hint: GitHub returns 404 (instead of 403) when the token cannot WRITE to a repository it can otherwise read.',
              'Hint: most common causes:',
              '  - `env.GITHUB_TOKEN` is set to a PAT / app token without write access to this repository',
              '  - a fine-grained PAT that does not include this repository or lacks "Contents: Read and write"',
              '  - a classic PAT without the `repo` scope (`public_repo` is not enough for private repos)',
              '  - the token owner lost access to the repository / organization',
              '  - GITHUB_REPOSITORY points to a different repository than the token was issued for',
            ]
          : [
              'Hint: the resource does not exist or the token cannot see it (private repositories return 404 instead of 403).',
            ])
      )
      break
    case 409:
      hints.push(
        'Hint: conflict - the repository may be empty, archived or the git reference is being updated concurrently.'
      )
      break
    case 422:
      if (isCreateRelease) {
        const errors = JSON.stringify((err.response?.data as { errors?: unknown[] } | undefined)?.errors ?? [])
        if (errors.includes('already_exists')) {
          hints.push(
            'Hint: a release with this tag already exists. Delete it, pass a different `tag`, or check why the version was not bumped (release name must match the version pattern).'
          )
        } else if (errors.includes('target_commitish')) {
          hints.push(
            'Hint: GITHUB_SHA is not a commit/branch that exists in this repository (was it force-pushed away?).'
          )
        } else {
          hints.push(
            'Hint: GitHub rejected the release (invalid tag name, tag already used by a release, or invalid target commit).'
          )
        }
      }
      break
    default:
      if (err.status >= 500)
        hints.push(
          'Hint: GitHub had a server error (see https://www.githubstatus.com). Re-running the job usually helps.'
        )
  }

  return hints
}

/** Removes anything that looks like a token from a string before logging it. */
export function redact(value: string): string {
  return value
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,})/g, '[REDACTED]')
    .replace(/\bxox[abposr]-[A-Za-z0-9-]+/g, '[REDACTED]')
}

/** Prints the full failure report and marks the action as failed. */
export function reportFailure(err: unknown) {
  const stepName = err instanceof StepError ? err.step : 'unknown step'
  const details = err instanceof StepError ? err.details : describeError(err)
  const message = err instanceof Error ? err.message : String(err)
  const stack = err instanceof StepError && err.cause instanceof Error ? err.cause.stack : (err as Error)?.stack

  core.error(`Step "${stepName}" failed: ${message}`, { title: `create-release: ${stepName} failed` })

  const report = [
    '',
    '━━━━━━━━━━━━━━━━━━━━ create-release failure report ━━━━━━━━━━━━━━━━━━━━',
    `Failed step: ${stepName}`,
    `Error: ${message}`,
    ...details,
    ...(stack ? ['Stack trace:', stack] : []),
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  ]
  core.info(redact(report.join('\n')))

  core.summary
    .addHeading('❌ create-release failed', 3)
    .addTable([
      [
        { data: 'Step', header: true },
        { data: 'Error', header: true },
      ],
      [stepName, message],
    ])
    .addCodeBlock(redact(details.join('\n') || '(no additional details)'))
    .write()
    .catch(() => undefined)

  core.setFailed(`${stepName}: ${message}`)
}
