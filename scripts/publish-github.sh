#!/usr/bin/env bash
set -euo pipefail

REPO_NAME="${1:-watchbuddy}"
VISIBILITY="${2:-public}"
DESCRIPTION="AI co-watching sidekick for YouTube, courses, keynotes, and streaming videos."

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI is required. Install it first: https://cli.github.com/"
  exit 1
fi

gh auth status >/dev/null

git status --short
npm run validate
npm run package

if ! git remote get-url origin >/dev/null 2>&1; then
  gh repo create "$REPO_NAME" \
    "--${VISIBILITY}" \
    --description "$DESCRIPTION" \
    --source . \
    --remote origin \
    --push
else
  git push -u origin "$(git branch --show-current)"
fi

echo "Published:"
gh repo view --web
