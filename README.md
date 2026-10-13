# Create release action

This action creates a release in GitHub. If a slack bot token is provided, it will also send a message to a slack channel.

## Inputs

- `use-sem-ver`: (default: `false`) Use semantic versioning. The default versioning is a `YYMM.revision` format (e.g. `2312.3` -> 2023. December 3rd release).
- `tag`: (default: Generated based on previous tags) Tag to use for the release. If you want to use a custom tag, you can provide it here. It must match `vYYMM.N` or `vX.Y.Z`, otherwise it is ignored (a warning is logged).
- `github-token`: (default: `${{ github.token }}`) Token used to call the GitHub API. Needs `contents: write`. If `env.GITHUB_TOKEN` is set, it takes precedence.

### Slack inputs

For this to work you'll need to create a Slack app, give it the `chat:write` bot scope (add `chat:write.public` to post in public channels without inviting the bot), install it to your workspace and use the **Bot User OAuth Token** (`xoxb-...`). Invite the bot to every private channel you post to (`/invite @your-bot`). You can find more information about this [here](https://api.slack.com/authentication/basics).

The Slack token is verified (`auth.test`) **before** the GitHub release is created, so a broken Slack setup never leaves you with a half-finished release.

- `SLACK_BOT_TOKEN`: Slack bot token
- `custom-github-changelog`: (default: `false`) Use custom changelog instead of the auto generated one. If you are passing in a custom body to github release, you can use this option to send the same body to slack.
- `create-release`: (default: `true`) Create a release in GitHub. If set to `false`, it will use the latest release.
- `blocks`: (default: `[]`) Slack blocks to send. This should be a javascript array as a string. You can find more information about slack blocks [here](https://api.slack.com/reference/block-kit/blocks)

> [!IMPORTANT]
> If you enable `custom-github-changelog` or `blocks`, the other formatting options won't work besides the `title`.

- `title`: (default: The github release title) Title of the release (You can use the `$release_name` variable to include the release name)
- `hide-authors`: (default: `false`) Hide authors in release notes
- `hide-prs`: (default: `false`) Hide PRs in release notes
- `hide-full-change-log-link` (default: `false`): Hide full changelog link in release notes
- `hide-title`: (default: `false`) Hide title in release notes
- `add-divider`: (default: `false`) Add divider in release notes
- `merge-items`: (default: `false`) Merge auto generated items in release notes. If you have a custom `release.yml` file and you provide a category which name includes one of the following words (`automated`, `automation`, `automatization`, `bot`, `script`, `generated`), the duplicated items will be merge to make the release note more readable.
- `channels`: Channels to publish to (`;` separated)
- `repost-channels`: Channels to repost to (`;` separated)
- `group-id`: Group ID to tag in the message (Used for showing the group handle in the release notes for easier tagging in case of an issue. E.g. `S083QT5S1GF`)

## Outputs

- `version`: The version of the release
- `release-url`: URL of the created GitHub release
- `release-id`: ID of the created GitHub release

## Troubleshooting

Every step runs in its own collapsible log group. When something fails, the log ends with a **failure report** that contains:

- the failed step (`Read inputs and environment`, `Verify Slack token`, `Fetch latest release`, `Compute next version`, `Create GitHub release`, `Send Slack release notes`)
- the exact GitHub/Slack request, HTTP status, error code, request ID, accepted permissions / token scopes and rate limit
- a hint explaining the most likely cause (expired token, missing `contents: write`, SAML SSO, bot not in channel, missing Slack scope, invalid blocks, ...)
- for a failed release creation: diagnostics showing the token's repository permissions, whether the tag/release already exists and whether the target commit exists

The same summary is written to the job summary. Enable [debug logging](https://docs.github.com/en/actions/monitoring-and-troubleshooting-workflows/troubleshooting-workflows/enabling-debug-logging) to also see the full Slack payloads.

## Example usage

> [!IMPORTANT]
> The job needs `permissions: contents: write`. The built-in token is used automatically; set `github-token` (or `env.GITHUB_TOKEN`) only if you want to use a different token.

### Usage with creating a release

```yaml
name: Create release
on:
  push:
    branches:
      - main
jobs:
  create-release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - name: Create release
        uses: nbotond20/create-release@v4.0.0
        with:
          use-sem-ver: true
```

If you want to see nicely structured release notes, you can create a `release.yml` file under the `.github` folder with the following content:

```yaml
# .github/release.yml

changelog:
  exclude:
    labels:
      - ignore-for-release
    authors:
      - octocat
  categories:
    - title: Breaking Changes 🛠
      labels:
        - Semver-Major
        - breaking-change
    - title: Exciting New Features 🎉
      labels:
        - Semver-Minor
        - enhancement
    - title: Automated Fixes 🤖
      labels:
        - automation
    - title: Other Changes
      labels:
        - '*'
```

For more information about the custom release notes, check out the offical github [documentation](https://docs.github.com/en/repositories/releasing-projects-on-github/automatically-generated-release-notes).

## Development

```sh
pnpm install
pnpm check   # typecheck, lint, format check and tests
pnpm build   # bundles src/ into dist/ (commit the result)
```

The pre-push hook runs `pnpm check` and refuses to push when `dist/` is out of date. CI does the same on every pull request.
