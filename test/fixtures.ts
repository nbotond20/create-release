export const PLAIN_BODY = [
  "## What's Changed",
  '* Add login page by @alice in https://github.com/acme/app/pull/10',
  '* Fix crash INC-123 by @bob in https://github.com/acme/app/pull/11',
  '<!-- hidden comment -->',
  '',
  '## New Contributors',
  '* @bob made their first contribution in https://github.com/acme/app/pull/11',
  '',
  '',
  '**Full Changelog**: https://github.com/acme/app/compare/v1.0.0...v1.0.1',
].join('\n')

export const SECTIONED_BODY = [
  '<!-- Release notes generated using configuration in .github/release.yml at main -->',
  '',
  "## What's Changed",
  '### Exciting New Features 🎉',
  '* Add search by @alice in https://github.com/acme/app/pull/20',
  '### Automated Fixes 🤖',
  '* Bump lodash by @dependabot in https://github.com/acme/app/pull/21',
  '* Bump lodash by @dependabot in https://github.com/acme/app/pull/22',
  '* Bump react by @dependabot in https://github.com/acme/app/pull/23',
  '### Other Changes',
  '* Refactor INC-7 and INC-7 by @carol in https://github.com/acme/app/pull/24',
  '',
  '',
  '**Full Changelog**: https://github.com/acme/app/compare/v2610.1...v2610.2',
].join('\n')
