#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
test_root=$(mktemp -d "${TMPDIR:-/tmp}/vpsmon-retention-test.XXXXXX")
cleanup() {
  resolved=$(readlink -f -- "$test_root")
  case "$resolved" in
    "${TMPDIR:-/tmp}"/vpsmon-retention-test.*|/tmp/vpsmon-retention-test.*) rm -rf -- "$resolved" ;;
    *) echo "refusing unsafe test cleanup: $resolved" >&2; exit 1 ;;
  esac
}
trap cleanup EXIT HUP INT TERM

VPSMON_UPGRADE_LIBRARY_ONLY=1 . "$script_dir/upgrade-agent.sh"

for stamp in \
  20260820T010101Z \
  20260821T010101Z \
  20260822T010101Z \
  20260823T010101Z \
  20260824T010101Z
do
  mkdir "$test_root/upgrade-backup.$stamp"
done
mkdir "$test_root/upgrade-backup.latest"
mkdir "$test_root/unrelated-data"

deleted=$(prune_upgrade_backups "$test_root" 3)
[ "$deleted" = "2" ]
[ ! -e "$test_root/upgrade-backup.20260820T010101Z" ]
[ ! -e "$test_root/upgrade-backup.20260821T010101Z" ]
[ -d "$test_root/upgrade-backup.20260822T010101Z" ]
[ -d "$test_root/upgrade-backup.20260823T010101Z" ]
[ -d "$test_root/upgrade-backup.20260824T010101Z" ]
[ -d "$test_root/upgrade-backup.latest" ]
[ -d "$test_root/unrelated-data" ]

if prune_upgrade_backups "$test_root" 0 >/dev/null 2>&1; then
  echo "zero retention unexpectedly accepted" >&2
  exit 1
fi
if prune_upgrade_backups "$test_root" 21 >/dev/null 2>&1; then
  echo "oversized retention unexpectedly accepted" >&2
  exit 1
fi

echo "upgrade backup retention tests passed"
