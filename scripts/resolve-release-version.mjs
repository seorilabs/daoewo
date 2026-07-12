#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const MAX_VERSION_CODE = 2_100_000_000;
const TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function parseArgs(argv) {
  const options = { tag: '', githubOutput: false, githubStepSummary: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--') continue;
    if (value === '--github-output') options.githubOutput = true;
    else if (value === '--github-step-summary') options.githubStepSummary = true;
    else if (value === '--tag') options.tag = argv[++index] ?? '';
    else if (value.startsWith('--tag=')) options.tag = value.slice(6);
    else throw new Error(`Unknown argument: ${value}`);
  }
  return options;
}

function packageTag() {
  const value = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  return `v${value}`;
}

export function resolveVersion(tag) {
  const match = TAG.exec(tag);
  if (match == null) throw new Error(`Release tag must match vX.Y.Z: ${tag}`);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (minor >= 1000 || patch >= 1000) throw new Error('minor and patch must be less than 1000.');
  const versionCode = major * 1_000_000 + minor * 1_000 + patch;
  if (versionCode < 1 || versionCode > MAX_VERSION_CODE) {
    throw new Error(`Calculated build number is outside 1..${MAX_VERSION_CODE}: ${versionCode}`);
  }
  const version = `${major}.${minor}.${patch}`;
  return {
    tag,
    version,
    version_name: version,
    android_version_code: String(versionCode),
    apple_marketing_version: version,
    apple_build_number: String(versionCode),
    release_name: tag,
  };
}

function appendOutput(path, values) {
  appendFileSync(path, `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')}\n`);
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const values = resolveVersion(options.tag || packageTag());
    if (options.githubOutput) {
      if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required with --github-output.');
      appendOutput(process.env.GITHUB_OUTPUT, values);
    }
    if (options.githubStepSummary && process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Release version\n\n- ${values.release_name}\n- build ${values.android_version_code}\n`);
    }
    console.log(JSON.stringify(values, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
