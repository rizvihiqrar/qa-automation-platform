#!/usr/bin/env bash
# Installs Chromium (or the browsers named as arguments: chromium firefox) and its system packages for Playwright, and survives the ways GitHub's
# runners make that fail. Run it from the package directory.
#  - apt can stall on a mirror (2026-10-22: 20 minutes in the middle of `apt-get update`),
#    so each try is cut off after 300 s.
#  - Cutting a try off kills playwright but not the `apt-get` it started, which keeps
#    downloading and holds the dpkg lock; the next try then fails at once on the lock.
#    So before each new try this waits (up to 240 s) for any running apt or dpkg to finish.
#    The orphan usually finishes the installing, and the next try has little left to do.
#  - A mirror that stops answering used to hang apt, and the lock with it, for minutes (the
#    course job on 2026-10-22 lost 13 minutes that way). apt is told to give up on a silent
#    connection after 20 s and to retry a download 3 times, before playwright runs it.
if [ -d /etc/apt/apt.conf.d ] && command -v sudo >/dev/null 2>&1; then
  printf 'Acquire::http::Timeout "20";\nAcquire::https::Timeout "20";\nAcquire::Retries "3";\n' | sudo tee /etc/apt/apt.conf.d/99-ci-timeouts >/dev/null || true
fi
#  - 2026-10-23, regression shard 1: the Azure mirror kept failing single packages (apt `Ign:`
#    lines), so try 1 used all 300 s, and the orphaned apt-get it left behind held the lock for
#    the whole 240 s wait. Tries 2 and 3 then died on the lock at once (exit 100). So an orphaned
#    apt-get is stopped instead of waited for (a running dpkg is never stopped: it is installing),
#    and from the second try apt uses archive.ubuntu.com instead of the Azure mirror.
for attempt in 1 2 3; do
  timeout -k 10 300 npx playwright install --with-deps "${@:-chromium}" && exit 0
  echo "Browser install attempt $attempt of 3 failed."
  [ "$attempt" -lt 3 ] || break
  if ! pgrep -x dpkg >/dev/null; then
    sudo pkill -x 'apt-get' || true
    sudo pkill -x 'apt' || true
    sleep 2
  fi
  for _ in $(seq 1 48); do
    pgrep -x 'apt-get|apt|dpkg' >/dev/null || break
    echo "Waiting for a running apt or dpkg to finish."
    ps -eo pid,etimes,args | grep -E '[a]pt-get|[a]pt |[d]pkg' | head -3
    sleep 5
  done
  sudo dpkg --configure -a || true
  # Use the main Ubuntu archive for the next try.
  sudo sed -i -E 's#mirror\+file:/etc/apt/apt-mirrors\.txt#http://archive.ubuntu.com/ubuntu/#; s#https?://azure\.archive\.ubuntu\.com/ubuntu/?#http://archive.ubuntu.com/ubuntu/#' /etc/apt/sources.list.d/ubuntu.sources /etc/apt/sources.list 2>/dev/null || true
  echo "Next try uses archive.ubuntu.com."
done
exit 1
