#!/bin/sh
# Permanently remove only the files and account owned by the Lume Agent.
set -eu
umask 077
[ "$(id -u)" -eq 0 ] || { echo "uninstall-agent.sh must run as root" >&2; exit 1; }
[ "${1:-}" = "--confirm" ] || { echo "usage: uninstall-agent.sh --confirm [expected-node-id-file]" >&2; exit 2; }

managed_directories() {
  printf '%s\n' /etc/vpsmon /opt/vpsmon /var/lib/vpsmon \
    /etc/systemd/system/vpsmon-agent.service.d \
    /etc/systemd/system/vpsmon-nftables-snapshot.service.d \
    /etc/systemd/system/vpsmon-nftables-snapshot.timer.d
}
for path in $(managed_directories); do
  if [ -e "$path" ] || [ -L "$path" ]; then
    [ ! -L "$path" ] && [ "$(readlink -f -- "$path")" = "$path" ] || { echo "refusing redirected managed directory: $path" >&2; exit 1; }
  fi
done

# The manager supplies the selected ID. Verify the actual remote identity before
# stopping anything: an SSH alias may have been reassigned to another VPS.
if [ -n "${2:-}" ]; then
  expected=$(cat -- "$2")
  printf '%s\n' "$expected" | grep -Eq '^[a-z0-9][a-z0-9_-]{0,31}$' || exit 2
  if [ -f /etc/vpsmon/config.json ]; then
    [ -x /opt/vpsmon/vpsmon-agent ] || { echo "cannot verify Agent identity: binary is missing" >&2; exit 1; }
    identity=$(mktemp)
    trap 'rm -f -- "$identity"' 0 HUP INT TERM
    /opt/vpsmon/vpsmon-agent --config /etc/vpsmon/config.json --dry-run > "$identity" 2>/dev/null || { echo "cannot verify Agent identity" >&2; exit 1; }
    actual=$(awk -F '"' '/^[[:space:]]*"node_id"[[:space:]]*:/ {print $4}' "$identity")
    [ "$actual" = "$expected" ] || { echo "remote node does not match selected node; nothing removed" >&2; exit 1; }
    rm -f -- "$identity"
    trap - 0 HUP INT TERM
  fi
fi

account=$(getent passwd vpsmon || true)
if [ -n "$account" ]; then
  for tool in pgrep userdel groupdel; do
    command -v "$tool" >/dev/null || { echo "required command is missing: $tool" >&2; exit 1; }
  done
  account_home=$(printf '%s\n' "$account" | cut -d: -f6)
  account_shell=$(printf '%s\n' "$account" | cut -d: -f7)
  account_uid=$(printf '%s\n' "$account" | cut -d: -f3)
  [ "$account_uid" != 0 ] && [ "$account_home" = /var/lib/vpsmon ] || { echo "vpsmon is not the dedicated Agent account" >&2; exit 1; }
  case "$account_shell" in */nologin|*/false) ;; *) echo "vpsmon is an interactive account; stopping" >&2; exit 1 ;; esac
fi
systemctl disable --now vpsmon-agent.service >/dev/null 2>&1 || true
systemctl disable --now vpsmon-nftables-snapshot.timer >/dev/null 2>&1 || true
systemctl stop vpsmon-nftables-snapshot.service >/dev/null 2>&1 || true
for unit in vpsmon-agent.service vpsmon-nftables-snapshot.service vpsmon-nftables-snapshot.timer; do
  active=$(systemctl is-active "$unit" 2>/dev/null || true)
  case "$active" in active|activating|reloading|deactivating) echo "service did not stop: $unit" >&2; exit 1 ;; esac
done
if [ -n "$account" ] && pgrep -u vpsmon >/dev/null 2>&1; then
  echo "vpsmon still owns running processes; stopping cleanup" >&2
  exit 1
fi

rm -f -- /etc/systemd/system/vpsmon-agent.service \
  /etc/systemd/system/vpsmon-nftables-snapshot.service \
  /etc/systemd/system/vpsmon-nftables-snapshot.timer
find /etc/systemd/system -mindepth 2 -maxdepth 2 -type l \
  \( -name vpsmon-agent.service -o -name vpsmon-nftables-snapshot.service -o -name vpsmon-nftables-snapshot.timer \) -delete
for path in $(managed_directories); do
  # Do not descend into another filesystem mounted beneath an Agent directory.
  rm -rf --one-file-system -- "$path"
  [ ! -e "$path" ] && [ ! -L "$path" ] || { echo "managed directory remains: $path" >&2; exit 1; }
done
if [ -n "$account" ]; then userdel vpsmon; fi
if getent group vpsmon >/dev/null; then groupdel vpsmon; fi
systemctl daemon-reload
systemctl reset-failed vpsmon-agent.service vpsmon-nftables-snapshot.service vpsmon-nftables-snapshot.timer >/dev/null 2>&1 || true
! getent passwd vpsmon >/dev/null || { echo "Agent account remains" >&2; exit 1; }
! getent group vpsmon >/dev/null || { echo "Agent group remains" >&2; exit 1; }

echo "Agent, configuration, queued reports, traffic state, upgrade backups and dedicated account removed"
