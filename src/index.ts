import core from "@actions/core";
import { Octokit } from "@octokit/action";
import { Version } from "./version";
import { SemanticVersion } from "./semantic-version";
import { Data, sendSlackReleaseNotes } from "./send-slack-release-notes.js";

const versionNumberPattern = /^v(\d{4})\.(\d+)$/;
const semverPattern = /^v(\d+)\.(\d+)\.(\d+)$/;

const octokit = new Octokit();
const [owner, repo] = process.env.GITHUB_REPOSITORY!.split("/");

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

async function createRelease(version: Version | SemanticVersion) {
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
    await sendSlackReleaseNotes(data as Data, config);

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
  } catch (err: any) {
    if (err.message !== "Not Found") {
      throw err;
    }
  }

  const useSemVer = core.getInput("use-sem-ver") === "true";

  const nextVersion = useSemVer
    ? new SemanticVersion()
    : new Version(new Date());

  if (!release) {
    console.log("No previous release found.");
    await createRelease(nextVersion);
    return;
  }

  const lastVersion = useSemVer
    ? semverPattern.exec(release.name!)
    : versionNumberPattern.exec(release.name!);

  if (lastVersion) {
    console.log(`Found previous version with valid name: ${lastVersion[0]}`);

    if (useSemVer) {
      (nextVersion as SemanticVersion).major = parseInt(lastVersion[1], 10);
      (nextVersion as SemanticVersion).minor = parseInt(lastVersion[2], 10);
      (nextVersion as SemanticVersion).patch = parseInt(lastVersion[3], 10) + 1;
    } else {
      (nextVersion as Version).revision =
        lastVersion[1] === (nextVersion as Version).datePart
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
