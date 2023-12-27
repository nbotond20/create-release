import { Version } from "./version.mjs";
import core from "@actions/core";
import { Octokit } from "@octokit/action";
import { SemanticVersion } from "./semantic-version.mjs";
import { sendSlackReleaseNotes } from "./send-slack-release-notes.mjs";

const versionNumberPattern = /^v(\d{4})\.(\d+)$/;
const semverPattern = /^v(\d+)\.(\d+)\.(\d+)$/;

const octokit = new Octokit();
const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");

const config = {
  title: core.getInput("title"),
  hideAuthors: core.getBooleanInput("hide-authors"),
  hidePRs: core.getBooleanInput("hide-prs"),
  hideFullChangeLogLink: core.getBooleanInput("hide-full-change-log-link"),
  hideTitle: core.getBooleanInput("hide-title"),
  addDivider: core.getBooleanInput("add-divider"),
  mergeItems: core.getBooleanInput("merge-items"),
  channel: core.getInput("channel"),
  repostChannels: core.getInput("repost-channels"),
  SLACK_BOT_TOKEN: core.getInput("SLACK_BOT_TOKEN"),
};

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

  if (core.getInput("SLACK_BOT_TOKEN"))
    await sendSlackReleaseNotes(data, config);

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
  .then(() => {
    console.log("Release created");
  })
  .catch((err) => {
    core.setFailed(`There was a problem: ${err.message}\n${err.stack}`);
  });
