#!/usr/bin/env bash
# Installs Chromium and its system packages for Playwright, and survives the two ways
# GitHub's runners make that fail: apt hanging on a mirror (a try is cut off after 240 s)
# and apt starting while the runner's own apt still holds the dpkg lock (a try fails at
# once, so waiting 45 s lets the other apt finish). Run it from the package directory.
for attempt in 1 2 3; do
  timeout -k 10 240 npx playwright install --with-deps chromium && exit 0
  echo "Browser install attempt $attempt of 3 failed."
  [ "$attempt" -lt 3 ] && sleep 45
done
exit 1
