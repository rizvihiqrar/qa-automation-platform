#!/usr/bin/env bash
# Runs a command up to 3 times, waiting 10 s then 20 s between tries. For steps that fetch from a
# registry or an API, which answer 502 or 504 now and then (CI run 40954762292, 2026-10-29: Docker Hub,
# postgres:17; CI health run 41061482935, 2026-10-30: HTTP 504 from api.github.com). The messages go to
# stderr so $(...) around a command captures only its own output.
#   bash scripts/retry.sh docker pull some/image:tag
# RETRY_WAIT=0 skips the waits (the tests use it).
for attempt in 1 2 3; do
  "$@" && exit 0
  echo "Attempt $attempt of 3 failed: $*" >&2
  if [ "$attempt" -lt 3 ]; then
    sleep $((attempt * ${RETRY_WAIT:-10}))
  fi
done
exit 1
