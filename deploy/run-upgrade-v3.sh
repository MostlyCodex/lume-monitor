#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "run-upgrade-v3.sh must run as root" >&2
  exit 1
fi

if [ "$#" -ne 1 ]; then
  echo "usage: run-upgrade-v3.sh /tmp/vpsmon-stage.ID" >&2
  exit 2
fi

stage=$(readlink -f -- "$1")
case "$stage" in
  /tmp/vpsmon-stage.*) ;;
  *) echo "refusing stage path outside /tmp/vpsmon-stage.*" >&2; exit 2 ;;
esac

python3 "$stage/upgrade-config-v3.py" "$stage/metadata.json" "$stage/config.json"
(
  cd "$stage"
  sha256sum vpsmon-agent config.json vpsmon-agent.service > checksums.sha256
)
VPSMON_V3_CONVERTED=1 sh "$stage/upgrade-agent.sh" "$stage"
find "$stage" -mindepth 1 -maxdepth 1 -type f -delete
rmdir "$stage"
echo "temporary_stage_removed=yes"
