#!/bin/sh
set -e

cd "$(dirname -- "$0")"

stamp="$(date +%Y%m%d-%H%M%S)"
backup_branch="backup-before-github-sync-$stamp"

echo "Connecting to GitHub..."
git fetch origin main

if git merge-base --is-ancestor HEAD origin/main; then
  echo "Creating local backup branch: $backup_branch"
  git branch "$backup_branch"

  echo "Aligning local Git history with GitHub without replacing working files..."
  git reset --mixed origin/main
fi

chmod +x scripts/check-macos.sh \
  scripts/dev-macos.sh \
  scripts/project-env.sh \
  scripts/setup-macos.sh

git add -A
if ! git diff --cached --quiet; then
  git commit -m "Sync local project changes"
fi

git pull --rebase origin main

echo "Pushing to GitHub..."
git push origin main

echo
echo "Sync completed."
echo "Backup branch: $backup_branch"
printf "Press Enter to close..."
read -r answer
