#!/usr/bin/env node
/**
 * Print maintainer issue counts for Stellar Wave triage.
 *
 * Usage:
 *   node scripts/issue-triage.js
 *   GITHUB_REPOSITORY=owner/repo node scripts/issue-triage.js
 *   node scripts/issue-triage.js owner/repo
 *
 * Set GITHUB_TOKEN to raise GitHub API rate limits.
 */

const DEFAULT_REPOSITORY =
  process.env.GITHUB_REPOSITORY || "Maximum-Prosper/StellarYield";

const repository = process.argv[2] || DEFAULT_REPOSITORY;
const token = process.env.GITHUB_TOKEN;

const states = [
  {
    label: "Unclaimed Wave Issues",
    query: `repo:${repository} is:issue is:open label:"Stellar Wave" label:"help wanted" no:assignee`,
  },
  {
    label: "Claimed Wave Issues",
    query: `repo:${repository} is:issue is:open label:"Stellar Wave" assignee:*`,
  },
  {
    label: "PRs Ready for Review",
    query: `repo:${repository} is:pr is:open label:"Stellar Wave" review:required`,
  },
  {
    label: "Blocked Issues",
    query: `repo:${repository} is:issue is:open label:"blocked"`,
  },
];

async function countSearchResults(query) {
  const params = new URLSearchParams({ q: query, per_page: "1" });
  const response = await fetch(`https://api.github.com/search/issues?${params}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub search failed (${response.status}): ${body}`);
  }

  const data = await response.json();
  return data.total_count;
}

async function runTriage() {
  console.log(`Maintainer triage summary for ${repository}`);

  for (const state of states) {
    const count = await countSearchResults(state.query);
    console.log(`- ${state.label}: ${count}`);
  }
}

runTriage().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
