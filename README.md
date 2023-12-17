# Create release action

This action creates a release in GitHub. If a slack bot token is provided, it will also send a message to a slack channel.

## Inputs

- `use-sem-ver`: Use semantic versioning
- `tag`: Tag to use for the release

### Slack inputs

- `SLACK_BOT_TOKEN`: Slack bot token
- `title`: Title of the release (You can use the `$release_name` variable to include the release name)
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

> [!IMPORTANT]
> You will need to set `GITHUB_TOKEN` in environment variables and need to provide write access to the repository.

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
        uses: nbotond20/create-release@v1.1.1
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
    - title: Other Changes
      labels:
        - "*"
```

For more information about the custom release notes, check out the offical github [documentation](https://docs.github.com/en/repositories/releasing-projects-on-github/automatically-generated-release-notes).
