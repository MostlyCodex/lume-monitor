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
systemctl disable --now vpsmon-nftables-snapshot.timer >/dev/null 2>&1 || true
systemctl stop vpsmon-nftables-snapshot.service >/dev/null 2>&1 || true
rm -f -- /etc/systemd/system/vpsmon-agent.service \
  /etc/systemd/system/vpsmon-nftables-snapshot.service \
  /etc/systemd/system/vpsmon-nftables-snapshot.timer \
  /etc/vpsmon/config.json /opt/vpsmon/vpsmon-agent \
  /var/lib/vpsmon/nftables-counters.json
rmdir -- /etc/vpsmon /opt/vpsmon >/dev/null 2>&1 || true
systemctl daemon-reload

echo "monitor services, optional snapshot helper, and configuration removed"
echo "vpsmon user and /var/lib/vpsmon were retained for recoverability"
