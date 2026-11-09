#!/usr/bin/env bash
# Pulls the latest version of the calendar and restarts it. Runs nightly; safe to run by hand.
set -e
cd "$(dirname "$0")/.."
before="$(git rev-parse HEAD)"
git pull --ff-only -q
if [ "$(git rev-parse HEAD)" != "$before" ]; then
  npm install --omit=dev --no-audit --no-fund -q
  sudo systemctl restart family-calendar
  echo "Updated to $(git rev-parse --short HEAD)"
fi
