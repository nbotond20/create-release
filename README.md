# Create release action

This action creates a release in GitHub. If a slack bot token is provided, it will also send a message to a slack channel.

> [!IMPORTANT]
> You will need to set `GITHUB_TOKEN` in environment variables for this action to work.
> Example:
>
> ```yaml
> env:
>   GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
> ```

## Inputs

- `use-sem-ver`: Use semantic versioning
- `tag`: Tag to use for the release

### Slack inputs

- `SLACK_BOT_TOKEN`: Slack bot token
- `title`: Title of the release
- `hide-authors`: Hide authors in release notes
- `hide-prs`: Hide PRs in release notes
- `hide-full-change-log-link`: Hide full changelog link in release notes
- `hide-title`: Hide title in release notes
- `add-divider`: Add divider in release notes
- `channel`: Channel to publish to
- `repost-channels`: Channels to repost to (`;` separated)

## Outputs

- `version`: The version of the release

## Example usage

```yaml
uses: nbotond20/create-release@v1.0.2
with:
  use-sem-ver: true # Optional
  tag: v1.0.0 # Optional
```
