# Create release action

This action creates a release in GitHub. If a slack bot token is provided, it will also send a message to a slack channel.

## Inputs

- `use-sem-ver`: (default: `false`) Use semantic versioning. The default versioning is a `YYMM.revision` format (e.g. `2312.3` -> 2023. December 3rd release).
- `tag`: (default: Generated based on previous tags) Tag to use for the release. If you want to use a custom tag, you can provide it here.

### Slack inputs

For this to work you'll need to create a Slack app and add it to your workspace. You'll also need to enable `Incoming Webhooks` for your app. You can find more information about this [here](https://api.slack.com/authentication/basics).

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

## Example usage

> [!IMPORTANT]
> You will need to set `GITHUB_TOKEN` in environment variables and need to provide write access to the repository.

### Usage with creating a release

```yaml
name: Create release
on:
  push:
    branches:
      - main
env:
  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
jobs:
  create-release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - name: Create release
        uses: nbotond20/create-release@v1.2.5
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
