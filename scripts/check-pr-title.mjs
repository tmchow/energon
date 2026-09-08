#!/usr/bin/env node
/**
 * Squash merge uses the PR title as the commit on main.
 * Lint that title as Conventional Commits. Branch commits are not checked.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const PR_TITLE_TYPES = [
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
  "revert",
];

const TITLE_RE = new RegExp(
  `^(${PR_TITLE_TYPES.join("|")})(\\([a-z0-9][a-z0-9._/-]*\\))?(!)?: (.+)$`,
);

const USAGE = `PR title must be a Conventional Commit (squash merge uses it as the commit on main).

Format: type(scope)?: subject
Types: ${PR_TITLE_TYPES.join(", ")}
Scope is optional, lowercase. Breaking change: feat(v1)!: ...
Subject is lowercase imperative, no trailing period.

Yes: feat(hub): show expiry on the catalog row
No:  Cap public edge cache at one day
No:  feat: Cap public edge cache`;

export function prTitleError(title) {
  const trimmed = title.trim();
  if (!trimmed) {
    return "PR title is empty.\n\n" + USAGE;
  }
  const match = TITLE_RE.exec(trimmed);
  if (!match) {
    return USAGE;
  }
  const subject = match[4];
  if (/^[A-Z]/.test(subject)) {
    return `Subject must start with a lowercase letter (got "${subject}").\n\n` + USAGE;
  }
  if (subject.endsWith(".")) {
    return `Subject must not end with a period (got "${subject}").\n\n` + USAGE;
  }
  return null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const error = prTitleError(process.env.PR_TITLE ?? "");
  if (error) {
    console.error(error);
    process.exit(1);
  }
}
