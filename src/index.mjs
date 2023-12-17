import { Version } from "./version.mjs";
import core from "@actions/core";
import { Octokit } from "@octokit/action";
import { SemanticVersion } from "./semantic-version.mjs";

const versionNumberPattern = /^v(\d{4})\.(\d+)$/;
const semverPattern = /^v(\d+)\.(\d+)\.(\d+)$/;

const octokit = new Octokit();
const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");

function getBooleanInput(name, defaultValue) {
  const value = core.getInput(name);
  if (!value) {
    return defaultValue;
  }
  return value === "true";
}

async function sendSlackReleaseNotes(data) {
  const input = {
    title: core.getInput("title"),
    hideAuthors: getBooleanInput("hide-authors", false),
    hidePRs: getBooleanInput("hide-prs", false),
    hideFullChangeLogLink: getBooleanInput("hide-full-change-log-link", false),
    hideTitle: getBooleanInput("hide-title", false),
    addDivider: getBooleanInput("add-divider", false),
    channel: core.getInput("channel"),
    repostChannels: core.getInput("repost-channels"),
    SLACK_BOT_TOKEN: core.getInput("SLACK_BOT_TOKEN"),
  };

  if (!input.channel) {
    throw new Error("Channel is not set");
  }

  const createSlackLinkFromPRLink = (prLink) => {
    const prNumber = prLink.split("/").pop();
    return `<${prLink}|#${prNumber}>`;
  };

  let body = data.body;

  // Get title (replace $release_name with the version number if needed)
  const title = input.title
    ? input.title.replace("$release_name", data.name)
    : data.name;

  // Get full changelog link
  const fullChangelogLink = body.split("\n\n\n").pop().trim();

  // Get sections
  let sections;
  const isSectioned = body.includes("### ");
  // This is a check to see if the changelog is in a sectioned format (uses release.yml) or not
  if (isSectioned) {
    sections = body
      .replace(`\n\n${fullChangelogLink}`, "") // Remove the changelog from the body
      .trim() // Remove leading and trailing newlines
      .split("### ") // Split into sections
      .slice(1) // Remove the first empty section
      .join("")
      .split("\n")
      .map((line) =>
        line.includes("*")
          ? line.replace("*", "•")
          : `<section-title>*${line}*\n`,
      ) // Replace * with • and wrap section titles in *
      .join("\n");
  } else {
    sections = body
      .replace(`${fullChangelogLink}`, "") // Remove the changelog from the body
      .trim() // Remove leading and trailing newlines
      .replace(/## What's Changed\n/g, "") // Remove ## title
      .replaceAll("*", "•"); // Replace * with •
  }

  if (input.hideAuthors) {
    // Remove authors from sections
    sections = sections.replaceAll(/ by @\w+/g, "");
  } else {
    // Replace github tags with slack links (format: <link|text>)
    const githubTags = sections.match(/@([^ ]+)/g);
    Array.from(new Set(githubTags))?.forEach((tag) => {
      sections = sections.replaceAll(
        tag,
        `<https://github.com/${tag.replace("@", "")}|${tag}>`,
      );
    });
  }

  if (input.hidePRs) {
    // Remove pull request links from sections
    sections = sections.replaceAll(
      / in https:\/\/github\.com\/[^\s]+\/pull\/\d+/g,
      "",
    );
  } else {
    // Replace pull request links with slack links (format: <link|text>)
    const pullRequestLinks = sections.match(
      /https:\/\/github\.com\/[^\s]+\/pull\/\d+/g,
    );
    Array.from(new Set(pullRequestLinks))?.forEach((prLink) => {
      sections = sections.replaceAll(prLink, createSlackLinkFromPRLink(prLink));
    });
  }

  // Create header block
  const headerBlock = !input.hideTitle
    ? [
        {
          text: {
            emoji: true,
            text: title,
            type: "plain_text",
          },
          type: "header",
        },
      ]
    : [];

  // Create changelog block
  const changelogLinkBlock = !input.hideFullChangeLogLink
    ? [
        {
          type: "context",
          elements: [
            {
              text: fullChangelogLink.replaceAll("**", "*"),
              type: "mrkdwn",
            },
          ],
        },
      ]
    : [];

  // Create blocks from sections
  const sectionArray = isSectioned
    ? sections.split("<section-title>").slice(1)
    : [sections]; // Split into sections and remove the first empty section
  const sectionBlocks = sectionArray
    .filter((section) => section !== "") // Remove empty sections
    .map((section) => {
      return {
        text: {
          text: section,
          type: "mrkdwn",
        },
        type: "section",
      };
    })
    .map(
      (section, idx) =>
        idx < sectionArray.length - 1 && input.addDivider
          ? [section, { type: "divider" }]
          : [section], // Add dividers between sections
    );

  // Create action block
  const repostChannels = input.repostChannels
    .split(";")
    .map((channel) => `#${channel}`)
    .join(", ");
  const actionBlock = input.repostChannels
    ? [
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                emoji: true,
                text: "Approve",
              },
              style: "primary",
              value: input.repostChannels,
              action_id: "approve_release_notes",
              confirm: {
                title: {
                  type: "plain_text",
                  text: "Are you sure?",
                },
                text: {
                  type: "plain_text",
                  text: `By approving this release note, you will post it to the following channel(s): ${repostChannels}`,
                },
                confirm: {
                  type: "plain_text",
                  text: "Approve",
                },
                deny: {
                  type: "plain_text",
                  text: "Cancel",
                },
              },
            },
            {
              type: "button",
              text: {
                type: "plain_text",
                emoji: true,
                text: "Cancel",
              },
              style: "danger",
              action_id: "cancel_release_notes",
            },
          ],
        },
      ]
    : [];

  const slackPayload = {
    channel: input.channel,
    blocks: [
      ...headerBlock,
      ...sectionBlocks.flat(),
      ...changelogLinkBlock,
      ...actionBlock,
    ],
  };

  const slackAPIResponse = await fetch(
    "https://slack.com/api/chat.postMessage",
    {
      method: "POST",
      body: JSON.stringify(slackPayload),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.SLACK_BOT_TOKEN}`,
      },
    },
  );

  if (!slackAPIResponse.ok) {
    throw new Error("Error sending slack message");
  }

  if (slackAPIResponse.warning) {
    throw new Error(`Slack error: ${slackAPIResponse.warning}`);
  }
}

async function createRelease(version) {
  console.log(`Using ${version} as the next version`);

  if (!process.env.GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN is not set");
  }

  if (!owner || !repo) {
    throw new Error("GITHUB_REPOSITORY is not set");
  }

  const tag = core.getInput("tag");
  const isValidTag = versionNumberPattern.test(tag) || semverPattern.test(tag);

  const { data } = await octokit.request(
    "POST /repos/{owner}/{repo}/releases",
    {
      owner,
      repo,
      tag_name: isValidTag ? tag : version.toString(),
      generate_release_notes: true,
      target_commitish: process.env.GITHUB_SHA,
    },
  );

  if (core.getInput("SLACK_BOT_TOKEN")) await sendSlackReleaseNotes(data);

  core.setOutput("version", isValidTag ? tag : version.toString());
}

async function run() {
  let release;
  try {
    const response = await octokit.request(
      "GET /repos/{owner}/{repo}/releases/latest",
      { owner, repo },
    );
    release = response.data;
  } catch (err) {
    if (err.message !== "Not Found") {
      throw err;
    }
  }

  const useSemVer = core.getInput("use-sem-ver") === "true";

  if (!release) {
    console.log("No previous release found.");
    await createRelease(nextVersion);
    return;
  }

  const lastVersion = useSemVer
    ? semverPattern.exec(release.name)
    : versionNumberPattern.exec(release.name);

  const nextVersion = useSemVer
    ? new SemanticVersion()
    : new Version(new Date());

  if (lastVersion) {
    console.log(`Found previous version with valid name: ${lastVersion[0]}`);

    if (useSemVer) {
      nextVersion.major = parseInt(lastVersion[1], 10);
      nextVersion.minor = parseInt(lastVersion[2], 10);
      nextVersion.patch = parseInt(lastVersion[3], 10) + 1;
    } else {
      nextVersion.revision =
        lastVersion[1] === nextVersion.datePart
          ? parseInt(lastVersion[2], 10) + 1
          : 1;
    }
  } else {
    console.warn("Last version number does not match the pattern");
  }

  await createRelease(nextVersion);
}

run()
  .then(() => console.log("done"))
  .catch((err) => {
    core.setFailed(`There was a problem: ${err.message}\n${err.stack}`);
  });
