#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "uninstall-agent.sh must run as root" >&2
  exit 1
fi
if [ "${1:-}" != "--confirm" ]; then
  echo "usage: uninstall-agent.sh --confirm" >&2
  exit 2
fi

systemctl disable --now vpsmon-agent.service >/dev/null 2>&1 || true
rm -f -- /etc/systemd/system/vpsmon-agent.service /etc/vpsmon/config.json /opt/vpsmon/vpsmon-agent
rmdir -- /etc/vpsmon /opt/vpsmon >/dev/null 2>&1 || true
systemctl daemon-reload

echo "monitor service and its configuration removed"
echo "vpsmon user and /var/lib/vpsmon were retained for recoverability"
