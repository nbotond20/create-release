import { RequestError } from '@octokit/request-error'

export function githubError(
  status: number,
  method: string,
  path: string,
  data: Record<string, unknown> = {},
  headers: Record<string, string> = {},
  body?: unknown
) {
  const url = `https://api.github.com${path}`
  return new RequestError(String(data.message ?? 'Error'), status, {
    request: { method: method as 'GET', url, headers: { authorization: 'token ghs_secret' }, body: body as string },
    response: { status, url, headers: { 'x-github-request-id': 'ABCD:1234', ...headers }, data },
  })
}
