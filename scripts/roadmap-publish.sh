#!/usr/bin/env bash
# Publishes your local edit of docs/roadmap.yml without a manual pull request.
#
#   pnpm roadmap:publish "add event catalog"
#
# Edit docs/roadmap.yml in your working tree, run this, and it:
#   1. checks the file parses as YAML (a broken file would break shopnex.ai/roadmap),
#   2. commits ONLY that file on a fresh branch off origin/main (in a temporary worktree, so your checkout is untouched),
#   3. opens a pull request and turns on auto-merge (squash). Branch protection stays as it is: the docs-only CI run
#      is cheap, and GitHub merges the PR as soon as the required checks pass.
#   4. resets your local copy of the file, since its content now lives in the PR. Run `git pull` once it has merged.
#
# The merge is made under YOUR gh login, so the push to main triggers the landing rebuild as usual.
# (A merge made by the Actions GITHUB_TOKEN would not trigger it. Do not move this into a workflow without a PAT.)
# Needs: gh logged in, "Allow auto-merge" enabled on the repo (it is).
set -euo pipefail

FILE="docs/roadmap.yml"
MSG="${1:-update roadmap}"
cd "$(git rev-parse --show-toplevel)"

if git diff --quiet -- "$FILE" && git diff --cached --quiet -- "$FILE"; then
  echo "No local changes in $FILE, nothing to publish." >&2
  exit 1
fi

# 1. validate. Ruby ships with macOS; skip with a warning if it is missing.
if command -v ruby >/dev/null 2>&1; then
  ruby -ryaml -e 'YAML.load_file(ARGV[0])' "$FILE" || { echo "$FILE is not valid YAML, fix it first." >&2; exit 1; }
else
  echo "warning: ruby not found, skipping the YAML check" >&2
fi

TODAY="$(date +%F)"
BRANCH="docs/roadmap-$(date +%Y%m%d-%H%M%S)"
TMP="$(mktemp -d)"
cleanup() { git worktree remove --force "$TMP/wt" >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

cp "$FILE" "$TMP/roadmap.yml"
git fetch -q origin main
git worktree add -q -b "$BRANCH" "$TMP/wt" origin/main

# 2. commit only the roadmap, with today's date in `updated:`
cp "$TMP/roadmap.yml" "$TMP/wt/$FILE"
sed -i.bak -E "s/^updated: .*/updated: $TODAY/" "$TMP/wt/$FILE" && rm -f "$TMP/wt/$FILE.bak"
git -C "$TMP/wt" add "$FILE"
if git -C "$TMP/wt" diff --cached --quiet; then
  echo "Your $FILE is identical to origin/main, nothing to publish." >&2
  git branch -D "$BRANCH" >/dev/null 2>&1 || true
  exit 1
fi
git -C "$TMP/wt" commit -q -m "docs(roadmap): $MSG"
git -C "$TMP/wt" push -q -u origin "$BRANCH"

# 3. PR + auto-merge
URL="$(gh pr create --base main --head "$BRANCH" --title "docs(roadmap): $MSG" \
  --body "Roadmap update, published with \`pnpm roadmap:publish\`. Only \`$FILE\` changes. Merges itself once the required checks pass.")"
gh pr merge "$URL" --auto --squash

# 4. the content now lives in the PR, so drop the local edit (main will bring it back on pull)
git checkout -- "$FILE"
git branch -D "$BRANCH" >/dev/null 2>&1 || true

echo
echo "$URL"
echo "Auto-merge is on. After it merges: git pull"
