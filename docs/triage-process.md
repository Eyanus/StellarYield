# Maintainer Issue Triage Process

This document outlines the weekly issue triage workflow for StellarYield maintainers, especially during the Stellar Wave program. It provides a repeatable workflow for claimed, unclaimed, blocked, and ready-for-review work without requiring private repository permissions.

## Triage States

- `unclaimed`: No contributor owns the issue. This is the default incoming state for public Wave issues.
- `claimed`: A contributor or maintainer has taken ownership and is actively working the issue.
- `blocked`: Work cannot proceed until an external dependency, maintainer answer, or deployment detail is available.
- `review-needed`: A pull request exists and needs maintainer review, CI verification, or deployment validation.

## Saved Search Queries

Use these GitHub searches to keep community work visible:

| State | Query | Action |
| --- | --- | --- |
| Unclaimed issues | `is:issue is:open label:"Stellar Wave" label:"help wanted" no:assignee` | Check clarity, add `good-first-issue` when appropriate, and invite contributors to claim. |
| Claimed issues | `is:issue is:open label:"Stellar Wave" assignee:*` | Check for stale claims and ask for an update after seven inactive days. |
| Ready for review | `is:pr is:open label:"Stellar Wave" review:required` | Assign or request a maintainer review. |
| Blocked issues | `is:issue is:open label:"blocked"` | Follow up on the missing input and remove the label once unblocked. |

## Weekly Triage Workflow

Every Monday, maintainers should:

1. Review new issues created in the past week and apply accurate labels such as `Stellar Wave`, `bug`, `enhancement`, or `points: 200`.
2. Run the saved searches above or `node scripts/issue-triage.js` from the repository root.
3. Re-open unclear issues with a short question and the `needs info` label.
4. Check stale claimed issues. If there has been no response for more than seven days, ask for an update before unassigning.
5. Review blocked issues and add a concrete next step, owner, and expected follow-up date.
6. Move PR-backed work into review by confirming linked issues, CI status, preview deployment status, and screenshots when UI changed.

## Public Contributor Workflow

Public contributors may not be assignable until they comment or join the repository workflow. If GitHub assignment is unavailable, add a comment such as:

```text
@username has claimed this issue.
```

Keep the claim visible in the issue thread, and ask contributors to link their PR with `Fixes #ISSUE_NUMBER` so review and closure stay connected.

## Escalation and Handoff

- If an issue is blocked for more than 24 hours, post a short context update and link the issue in the maintainer channel.
- If a PR is ready for review for more than 24 hours, tag the reviewer rotation with the PR link and the first needed action.
- If a contributor needs to hand off a claimed issue, ask them to leave their branch, test notes, and remaining task list in the issue.
