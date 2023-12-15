import { Version } from "./version.mjs";
import core from "@actions/core";
import { Octokit } from "@octokit/action";

const versionNumberPattern = /^v(\d{4})\.(\d+)$/;

const octokit = new Octokit();
const [owner, repo] = process.env.GITHUB_REPOSITORY.split("/");

async function createRelease(version) {
  console.log(`Using ${version} as the next version`);

  if (!process.env.GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN is not set");
  }

  if (!owner || !repo) {
    throw new Error("GITHUB_REPOSITORY is not set");
  }

  if (process.env.SLACK_BOT_TOKEN)
    await sendSlackReleaseNotes(version.toString());

  await octokit.request("POST /repos/{owner}/{repo}/releases", {
    owner,
    repo,
    tag_name: version.toString(),
    target_commitish: process.env.GITHUB_SHA,
  });

  core.setOutput("version", version.toString());
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
  const nextVersion = new Version(new Date());

  if (!release) {
    console.log("No previous release found.");
    await createRelease(nextVersion);
    return;
  }

  const lastVersion = versionNumberPattern.exec(release.name);
  if (lastVersion) {
    console.log(`Found previous version with valid name: ${lastVersion[0]}`);
    nextVersion.revision =
      lastVersion[1] === nextVersion.datePart
        ? parseInt(lastVersion[2], 10) + 1
        : 1;
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
