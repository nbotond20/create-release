export type SlackConfig = {
  channel: string
  SLACK_BOT_TOKEN: string
  title?: string
  hideTitle?: boolean
  hideAuthors?: boolean
  hidePRs?: boolean
  hideFullChangeLogLink?: boolean
  addDivider?: boolean
  mergeItems?: boolean
  repostChannels?: string
  customChangelog?: boolean
}

export type Data = {
  body: string
  name: string
}

export async function sendSlackReleaseNotes(data: Data, config: SlackConfig) {
  if (!config.channel) {
    throw new Error('Channel is not set')
  }

  const createSlackLinkFromPRLink = (prLink: string) => {
    const prNumber = prLink.split('/').pop()
    return `<${prLink}|#${prNumber}>`
  }

  const createSlackLinkFromChangeLogLink = (changeLogLink: string) => {
    const changeLogVersion = changeLogLink.split('/').pop()
    const changeLogParts = changeLogLink.split(': ')
    const changeLogText = changeLogParts[0]
    const link = changeLogParts[1]

    return `${changeLogText}: <${link}|${changeLogVersion}>`
  }

  // Get title (replace $release_name with the version number if needed)
  const title = config.title ? config.title.replace('$release_name', data.name) : data.name

  // If custom changelog is enabled, use the body as is
  if (config.customChangelog) {
    const slackPayload = {
      channel: config.channel,
      text: title,
      blocks: [
        {
          text: {
            emoji: true,
            text: title,
            type: 'plain_text',
          },
          type: 'header',
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: data.body,
          },
        },
      ],
    }

    const slackAPIResponse = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      body: JSON.stringify(slackPayload),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.SLACK_BOT_TOKEN}`,
      },
    })

    if (!slackAPIResponse.ok) {
      throw new Error('Error sending slack message')
    }

    return
  }

  // Get full changelog link
  const bodyWithoutNewContributorSection = data.body.replace(/## New Contributors[\s\S]*?\n\n/g, '\n')

  const fullChangelogLink = bodyWithoutNewContributorSection.split('\n\n\n')!.pop()!.trim()
  const fullChangelogSlackLink = createSlackLinkFromChangeLogLink(fullChangelogLink)

  // Get sections
  let sections: string
  const isSectioned = bodyWithoutNewContributorSection.includes('### ')
  // This is a check to see if the changelog is in a sectioned format (uses release.yml) or not
  if (isSectioned) {
    sections = bodyWithoutNewContributorSection
      .replace(fullChangelogLink, '') // Remove the changelog from the body
      .trim() // Remove leading and trailing newlines
      .split('### ') // Split into sections
      .slice(1) // Remove the first empty section
      .join('')
      .split('\n')
      .map(line => (line.includes('*') ? line.replace('*', '•') : `<section-title>*${line}*\n`)) // Replace * with • and wrap section titles in *
      .join('\n')
  } else {
    sections = bodyWithoutNewContributorSection
      .replace(fullChangelogLink, '') // Remove the changelog from the body
      .trim() // Remove leading and trailing newlines
      .replace(/## What's Changed\n/g, '') // Remove ## title
      .replaceAll('*', '•') // Replace * with •
      .replaceAll(/<!--[\s\S]*?-->/g, '') // Remove comments
  }

  if (config.hideAuthors) {
    // Remove authors from sections
    sections = sections.replaceAll(/ by @\S+/g, '')
  } else {
    // Replace github tags with slack links (format: <link|text>)
    const githubTags = sections.match(/@([^ ]+)/g)
    Array.from(new Set(githubTags))?.forEach(tag => {
      sections = sections.replaceAll(tag, `<https://github.com/${tag.replace('@', '')}|${tag}>`)
    })
  }

  if (config.hidePRs) {
    // Remove pull request links from sections
    sections = sections.replaceAll(/ in https:\/\/github\.com\/[^\s]+\/pull\/\d+/g, '')
  } else {
    // Replace pull request links with slack links (format: <link|text>)
    const pullRequestLinks = sections.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/g)
    Array.from(new Set(pullRequestLinks))?.forEach(prLink => {
      sections = sections.replaceAll(prLink, createSlackLinkFromPRLink(prLink))
    })
  }

  // Replace TCI numbers with slack links (format: <link|text>)
  const TCI_PATTERN = /INC-\d+/g
  const TCI_LINK = 'https://helpdesk.infinitaslearning.com/a/tickets/'
  const tcis = sections.match(TCI_PATTERN)
  if (tcis) {
    Array.from(new Set(tcis))?.forEach(tci => {
      const number = tci.split('-')[1]
      sections = sections.replaceAll(tci, `<${TCI_LINK}${number}|${tci}>`)
    })
  }

  // Create header block
  const headerBlock = !config.hideTitle
    ? [
        {
          text: {
            emoji: true,
            text: title,
            type: 'plain_text',
          },
          type: 'header',
        },
      ]
    : []

  // Create changelog block
  const changelogLinkBlock = !config.hideFullChangeLogLink
    ? [
        {
          type: 'context',
          elements: [
            {
              text: fullChangelogSlackLink.replaceAll('**', '*'),
              type: 'mrkdwn',
            },
          ],
        },
      ]
    : []

  const sectionArray = isSectioned ? sections.split('<section-title>').slice(1) : [sections] // Split into sections and remove the first empty section

  const AUTOMATION_KEYWORDS = ['automated', 'automation', 'automatization', 'bot', 'script', 'generated']
  const AUTOMATION_SECTION_REGEX = new RegExp(`.*\\*.*(${AUTOMATION_KEYWORDS.join('|')}.*).*\\*.*`, 'i')

  let automatedSections
  if (config.mergeItems) {
    automatedSections = sectionArray
      .filter(section => AUTOMATION_SECTION_REGEX.test(section))
      .map(section => {
        const items = section.split('\n')
        const title = items[0]
        const changes = items.splice(2)

        // Split the items into 3 groups: title, author, pr link
        const typeGroups = changes.map(change => change.split(/ by | in /).filter(item => !item.includes('|@')))
        // Create a map with the title as key and the links as values
        const titleLinkMap = typeGroups.reduce(
          (acc, curr) => {
            const title = curr[0]
            const prLink = curr[1]

            if (!acc[title]) {
              acc[title] = []
            }

            if (prLink) {
              acc[title].push(prLink)
            }

            return acc
          },
          {} as Record<string, string[]>
        )

        // Merge the links into a single string
        const linksString = Object.entries(titleLinkMap)
          .map(([title, links]) => {
            const linkString = links.join(', ')
            return `${title}${linkString ? ` in ${linkString}` : ''}`
          })
          .join('\n')

        return `${title}\n\n${linksString}`
      })
  }

  const sectionsWithoutAutomation = sectionArray.filter(section => !AUTOMATION_SECTION_REGEX.test(section))

  // Create blocks from sections
  const sectionBlocks = [
    ...((config.mergeItems ? sectionsWithoutAutomation : sectionArray) ?? []),
    ...(automatedSections ?? []),
  ]
    .filter(section => section !== '') // Remove empty sections
    .map(section => {
      return {
        text: {
          text: section,
          type: 'mrkdwn',
        },
        type: 'section',
      }
    })
    .map(
      (section, idx) =>
        idx < sectionArray.length - 1 && config.addDivider ? [section, { type: 'divider' }] : [section] // Add dividers between sections
    )

  // Create action block
  const repostChannels = config.repostChannels
    ?.split(';')
    .map(channel => `#${channel}`)
    .join(', ')

  const actionBlock = config.repostChannels
    ? [
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                emoji: true,
                text: 'Approve',
              },
              style: 'primary',
              value: config.repostChannels,
              action_id: 'approve_release_notes',
              confirm: {
                title: {
                  type: 'plain_text',
                  text: 'Are you sure?',
                },
                text: {
                  type: 'plain_text',
                  text: `By approving this release note, you will post it to the following channel(s): ${repostChannels}`,
                },
                confirm: {
                  type: 'plain_text',
                  text: 'Approve',
                },
                deny: {
                  type: 'plain_text',
                  text: 'Cancel',
                },
              },
            },
            {
              type: 'button',
              text: {
                type: 'plain_text',
                emoji: true,
                text: 'Cancel',
              },
              style: 'danger',
              action_id: 'cancel_release_notes',
            },
          ],
        },
      ]
    : []

  const slackPayload = {
    channel: config.channel,
    text: title,
    blocks: [...headerBlock, ...sectionBlocks.flat(), ...changelogLinkBlock, ...actionBlock],
  }

  const slackAPIResponse = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    body: JSON.stringify(slackPayload),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.SLACK_BOT_TOKEN}`,
    },
  })

  if (!slackAPIResponse.ok) {
    throw new Error('Error sending slack message')
  }
}
