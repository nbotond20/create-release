import * as core from '@actions/core'
import { DetailedError } from './logger.js'

const SLACK_API = 'https://slack.com/api'
const REQUEST_TIMEOUT_MS = 30_000
const MAX_ATTEMPTS = 3

// https://api.slack.com/reference/block-kit/blocks
const MAX_BLOCKS = 50
const MAX_SECTION_TEXT = 3000
const MAX_HEADER_TEXT = 150
const MAX_MESSAGE_TEXT = 40_000

type SlackResponse = {
  ok: boolean
  error?: string
  warning?: string
  needed?: string
  provided?: string
  ts?: string
  channel?: string
  user?: string
  team?: string
  bot_id?: string
  response_metadata?: { messages?: string[]; warnings?: string[] }
}

export type SlackBlock = { type: string; text?: { text?: string; [key: string]: unknown } } & Record<string, unknown>

export type SlackMessage = {
  channel: string
  text: string
  blocks: SlackBlock[]
}

/**
 * Explanations for every documented error of `chat.postMessage` / `auth.test`
 * plus the generic errors any Slack Web API method can return.
 */
const SLACK_ERROR_HINTS: Record<string, string> = {
  // Authentication
  not_authed: 'No token was sent. Make sure the `SLACK_BOT_TOKEN` secret exists and is passed to the action.',
  invalid_auth:
    'The Slack token is invalid. Check for typos/whitespace in the secret and that it is a bot token (`xoxb-...`).',
  token_expired:
    'The Slack token has EXPIRED. If token rotation is enabled for the app, use a non-rotating bot token or refresh it, then update the secret.',
  token_revoked:
    'The Slack token was REVOKED (app uninstalled or token regenerated). Reinstall the app and update the secret.',
  account_inactive: 'The user/bot that owns the token was deactivated, or the app was uninstalled from the workspace.',
  no_permission: 'The workspace token does not have permission to do this.',
  not_allowed_token_type:
    'This token type cannot call chat.postMessage. Use the Bot User OAuth Token (`xoxb-...`), not an app-level (`xapp-`) or config token.',
  missing_scope:
    'The Slack app is missing an OAuth scope (see "needed" above). Add it under OAuth & Permissions → Bot Token Scopes, REINSTALL the app and update the secret.',
  org_login_required: 'The workspace is undergoing an enterprise migration and is temporarily unavailable.',
  ekm_access_denied: 'Enterprise Key Management denied access. Contact your Slack admin.',
  team_access_not_granted:
    'The token is not granted access to this workspace (Enterprise Grid). Ask an admin to grant the app access.',
  enterprise_is_restricted: 'This method cannot be called from an Enterprise workspace.',
  two_factor_setup_required: 'Two-factor authentication must be set up for the token owner.',
  access_denied: 'Access to this resource is denied for this token.',
  accesslimited: 'Access to this method is limited on the current network.',
  team_added_to_org: 'The workspace is being migrated to an Enterprise org. Retry later.',

  // Channel problems
  not_in_channel:
    'The bot is NOT a member of this channel. Invite it in Slack with `/invite @<your-bot-name>` in that channel (or add the `chat:write.public` scope for public channels).',
  channel_not_found:
    'Channel not found. Use the channel ID (e.g. `C0123456789`, from channel details) instead of a name; for private channels the bot must be invited first.',
  is_archived: 'The channel is archived. Unarchive it or use a different channel.',
  duplicate_channel_not_found: 'The channel referenced for duplication was not found.',
  duplicate_message_not_found: 'The message referenced for duplication was not found.',
  messages_tab_disabled: 'Messages tab for the app is disabled (when posting to a DM). Enable it in App Home settings.',
  restricted_action: 'A workspace preference prevents the bot from posting in this channel.',
  restricted_action_read_only_channel:
    'The channel is read-only (announcement channel). Only admins/allowed members can post.',
  restricted_action_thread_only_channel: 'The channel only allows threaded replies.',
  restricted_action_non_threadable_channel: 'The channel does not allow threaded replies.',
  cannot_reply_to_message: 'This message type cannot be replied to.',
  ratelimited_channel: 'Too many messages to this channel. Wait and retry.',
  slack_connect_canvas_sharing_blocked: 'Slack Connect policy blocks this content.',
  slack_connect_file_link_sharing_blocked: 'Slack Connect policy blocks sharing file links in this channel.',
  slack_connect_lists_sharing_blocked: 'Slack Connect policy blocks sharing lists in this channel.',
  team_not_found: 'The workspace referenced by the channel could not be found.',
  user_not_found: 'The user referenced for the DM could not be found.',

  // Content problems
  no_text: 'The message has no text. Provide a `title` or content.',
  msg_too_long: `The message text is too long (max ${MAX_MESSAGE_TEXT} characters).`,
  msg_blocks_too_long:
    'The blocks payload is too long. Reduce the size of the release notes (e.g. enable `merge-items` or `hide-authors`).',
  too_many_attachments: 'Too many attachments (max 100).',
  invalid_blocks:
    'Slack rejected the blocks. See "Slack messages" above for the exact block/field. Common causes: section text > 3000 chars, header > 150 chars, > 50 blocks, invalid custom `blocks` JSON.',
  invalid_blocks_format: 'The `blocks` value is not a valid JSON array of Block Kit objects.',
  invalid_metadata_format: 'The message metadata is invalid.',
  invalid_metadata_schema: 'The message metadata does not match the schema.',
  metadata_too_large: 'The message metadata is too large.',
  metadata_must_be_sent_from_app: 'Metadata can only be posted by an app token.',
  as_user_not_supported: '`as_user` is not supported for this token.',
  invalid_attachments: 'The attachments are invalid.',

  // Request problems
  invalid_arguments: 'The request had invalid arguments.',
  invalid_arg_name: 'The request contains an invalid argument name.',
  invalid_array_arg: 'An array argument was sent incorrectly.',
  invalid_charset: 'The request charset is invalid.',
  invalid_form_data: 'The request form data is invalid.',
  invalid_post_type: 'The request content type is invalid.',
  missing_post_type: 'The request content type is missing.',
  invalid_json: 'The request body is not valid JSON.',
  json_not_object: 'The request JSON is not an object.',
  request_timeout: 'Slack timed out reading the request. Retry.',
  upgrade_required: 'The client is too old for this method.',
  deprecated_endpoint: 'The endpoint is deprecated.',
  method_deprecated: 'The method is deprecated.',

  // Slack-side problems
  ratelimited:
    'Slack rate limit hit. The action retries automatically; if it still fails, reduce the number of channels or retry later.',
  rate_limited:
    'Slack rate limit hit. The action retries automatically; if it still fails, reduce the number of channels or retry later.',
  fatal_error: 'Slack had a fatal server error. Retry the job (https://slack-status.com).',
  internal_error: 'Slack had an internal error. Retry the job (https://slack-status.com).',
  service_unavailable: 'Slack is unavailable. Retry the job (https://slack-status.com).',
}

/** Validates the token format so that obvious misconfigurations fail fast with a clear message. */
export function validateSlackToken(token: string): void {
  const trimmed = token.trim()
  if (trimmed !== token) {
    core.warning('SLACK_BOT_TOKEN has leading/trailing whitespace; it was trimmed. Check the secret value.')
  }
  if (trimmed.startsWith('https://hooks.slack.com/')) {
    throw new DetailedError('SLACK_BOT_TOKEN contains an Incoming Webhook URL, not a bot token', [
      'Hint: use the "Bot User OAuth Token" (`xoxb-...`) from OAuth & Permissions in your Slack app settings.',
    ])
  }
  if (trimmed.startsWith('xapp-')) {
    throw new DetailedError('SLACK_BOT_TOKEN is an app-level token (`xapp-`), which cannot post messages', [
      'Hint: use the "Bot User OAuth Token" (`xoxb-...`) from OAuth & Permissions in your Slack app settings.',
    ])
  }
  if (!/^xox[bpe]-/.test(trimmed)) {
    core.warning(
      `SLACK_BOT_TOKEN does not look like a Slack token (expected it to start with "xoxb-", got "${trimmed.slice(0, 5)}..."). Continuing anyway.`
    )
  } else if (!trimmed.startsWith('xoxb-')) {
    core.warning(
      'SLACK_BOT_TOKEN is not a bot token (`xoxb-`). User tokens post as the user and may need extra scopes.'
    )
  }
}

/** Splits a `;` separated channel list, trimming whitespace and dropping empty entries. */
export function parseChannels(channels: string): string[] {
  return channels
    .split(';')
    .map(channel => channel.trim())
    .filter(Boolean)
}

/** Checks a message against Slack's documented limits and returns human-readable problems. */
export function findBlockProblems(message: SlackMessage): string[] {
  const problems: string[] = []
  if (message.blocks.length > MAX_BLOCKS) {
    problems.push(`Message has ${message.blocks.length} blocks (Slack allows at most ${MAX_BLOCKS}).`)
  }
  if (message.text.length > MAX_MESSAGE_TEXT) {
    problems.push(`Fallback text is ${message.text.length} characters (max ${MAX_MESSAGE_TEXT}).`)
  }
  message.blocks.forEach((block, idx) => {
    const text = block.text?.text
    if (typeof text !== 'string') return
    if (block.type === 'header' && text.length > MAX_HEADER_TEXT) {
      problems.push(`Block #${idx} (header) text is ${text.length} characters (max ${MAX_HEADER_TEXT}).`)
    }
    if (block.type === 'section' && text.length > MAX_SECTION_TEXT) {
      problems.push(`Block #${idx} (section) text is ${text.length} characters (max ${MAX_SECTION_TEXT}).`)
    }
    if (text.trim() === '') problems.push(`Block #${idx} (${block.type}) has empty text, which Slack rejects.`)
  })
  return problems
}

async function callSlack(method: string, token: string, payload: object): Promise<SlackResponse> {
  for (let attempt = 1; ; attempt++) {
    let response: Response
    try {
      response = await fetch(`${SLACK_API}/${method}`, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (err) {
      const cause = (err as { cause?: { code?: string; message?: string } }).cause
      const reason =
        (err as Error).name === 'TimeoutError' ? `timed out after ${REQUEST_TIMEOUT_MS / 1000}s` : String(err)
      if (attempt < MAX_ATTEMPTS) {
        core.warning(`Slack ${method} network error (${reason}), retrying (attempt ${attempt + 1}/${MAX_ATTEMPTS})...`)
        await sleep(attempt * 2000)
        continue
      }
      throw new DetailedError(`Could not reach Slack (${method}): ${reason}`, [
        `Network error code: ${cause?.code ?? 'unknown'}${cause?.message ? ` - ${cause.message}` : ''}`,
        'Hint: check that the runner can reach https://slack.com (firewall / proxy / self-hosted runner network).',
      ])
    }

    const retryable = response.status === 429 || response.status >= 500
    if (retryable && attempt < MAX_ATTEMPTS) {
      const retryAfter = Number(response.headers.get('retry-after')) || attempt * 2
      core.warning(
        `Slack ${method} returned HTTP ${response.status}, retrying in ${retryAfter}s (attempt ${attempt + 1}/${MAX_ATTEMPTS})...`
      )
      await sleep(retryAfter * 1000)
      continue
    }

    const rawBody = await response.text()
    let body: SlackResponse
    try {
      body = JSON.parse(rawBody)
    } catch {
      throw new DetailedError(`Slack ${method} returned a non-JSON response (HTTP ${response.status})`, [
        `Response body: ${rawBody.slice(0, 500) || '(empty)'}`,
        response.status === 429
          ? 'Hint: Slack rate limit hit and retries were exhausted. Retry later.'
          : 'Hint: Slack may be having an outage (https://slack-status.com). Retry the job.',
      ])
    }

    if (!response.ok && body.ok !== false) {
      throw new DetailedError(`Slack ${method} failed with HTTP ${response.status}`, [
        `Response body: ${rawBody.slice(0, 500)}`,
      ])
    }
    return body
  }
}

function describeSlackError(method: string, body: SlackResponse, context: string[]): DetailedError {
  const error = body.error ?? 'unknown_error'
  return new DetailedError(`Slack ${method} failed: ${error}`, [
    ...context,
    `Slack error code: ${error}`,
    ...(body.needed ? [`Scope needed: ${body.needed}`] : []),
    ...(body.provided ? [`Scopes the token has: ${body.provided}`] : []),
    ...(body.response_metadata?.messages?.length
      ? [`Slack messages: ${body.response_metadata.messages.join(' | ')}`]
      : []),
    ...(body.warning ? [`Slack warning: ${body.warning}`] : []),
    `Hint: ${SLACK_ERROR_HINTS[error] ?? `See https://api.slack.com/methods/${method}#errors for "${error}".`}`,
  ])
}

/**
 * Calls `auth.test` to verify the token before anything else happens,
 * so a bad Slack token is reported *before* a GitHub release is created.
 */
export async function verifySlackToken(token: string): Promise<void> {
  const body = await callSlack('auth.test', token, {})
  if (!body.ok) throw describeSlackError('auth.test', body, [])
  core.info(`Slack token OK: bot user "${body.user}" (${body.bot_id ?? 'no bot id'}) in workspace "${body.team}"`)
}

/** Posts one message per channel. Tries every channel and reports all failures together. */
export async function postSlackMessages(token: string, channels: string[], build: (channel: string) => SlackMessage) {
  if (channels.length === 0) {
    throw new DetailedError('No Slack channels configured', [
      'Hint: set the `channels` input to one or more channel IDs separated by `;` (e.g. `C0123456789;C0987654321`).',
    ])
  }

  const failures: DetailedError[] = []
  for (const channel of channels) {
    const message = build(channel)
    const problems = findBlockProblems(message)
    problems.forEach(problem => core.warning(`Slack message for channel "${channel}" may be rejected: ${problem}`))

    core.info(`Posting release notes to Slack channel "${channel}" (${message.blocks.length} blocks)...`)
    core.debug(`Slack payload for "${channel}": ${JSON.stringify(message)}`)

    try {
      const body = await callSlack('chat.postMessage', token, message)
      if (!body.ok) {
        throw describeSlackError('chat.postMessage', body, [
          `Channel: ${channel}`,
          ...problems.map(problem => `Pre-check: ${problem}`),
        ])
      }
      body.response_metadata?.warnings?.forEach(warning => core.warning(`Slack warning for "${channel}": ${warning}`))
      core.info(`✔ Posted to "${channel}" (channel ${body.channel}, ts ${body.ts})`)
    } catch (err) {
      const detailed = err instanceof DetailedError ? err : new DetailedError(String(err), [])
      core.error(`Failed to post to Slack channel "${channel}": ${detailed.message}`)
      failures.push(detailed)
    }
  }

  if (failures.length > 0) {
    throw new DetailedError(
      `Failed to post to ${failures.length} of ${channels.length} Slack channel(s)`,
      failures.flatMap((failure, idx) => [`── Failure ${idx + 1}: ${failure.message}`, ...failure.details])
    )
  }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
