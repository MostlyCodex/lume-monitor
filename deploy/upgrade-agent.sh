#!/bin/sh
set -eu

umask 077

is_upgrade_backup_name() {
  printf '%s\n' "$1" | grep -Eq '^upgrade-backup\.[0-9]{8}T[0-9]{6}Z$'
}

prune_upgrade_backups() {
  state_dir=$1
  keep=$2
  case "$keep" in
    ''|*[!0-9]*|0) return 2 ;;
  esac
  [ "$keep" -le 20 ] || return 2

  resolved_state=$(readlink -f -- "$state_dir") || return 1
  [ "$resolved_state" = "$state_dir" ] || return 1
  [ -d "$resolved_state" ] || return 1

  candidates=$(find -P "$resolved_state" -mindepth 1 -maxdepth 1 -type d -name 'upgrade-backup.*' -print | LC_ALL=C sort -r)
  seen=0
  deleted=0
  while IFS= read -r candidate; do
    [ -n "$candidate" ] || continue
    base=${candidate##*/}
    is_upgrade_backup_name "$base" || continue
    resolved_candidate=$(readlink -f -- "$candidate") || return 1
    [ "$resolved_candidate" = "$candidate" ] || return 1
    case "$resolved_candidate" in
      "$resolved_state"/upgrade-backup.*) ;;
      *) return 1 ;;
    esac
    seen=$((seen + 1))
    if [ "$seen" -gt "$keep" ]; then
      rm -rf -- "$resolved_candidate" || return 1
      deleted=$((deleted + 1))
    fi
  done <<EOF
$candidates
EOF
  printf '%s\n' "$deleted"
}

if [ "${VPSMON_UPGRADE_LIBRARY_ONLY:-0}" = "1" ]; then
  return 0 2>/dev/null || exit 0
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "upgrade-agent.sh must run as root" >&2
  exit 1
fi

if [ "$#" -ne 1 ]; then
  echo "usage: upgrade-agent.sh /tmp/vpsmon-stage.ID" >&2
  exit 2
fi

keep_upgrade_backups=${VPSMON_KEEP_UPGRADE_BACKUPS:-3}
case "$keep_upgrade_backups" in
  ''|*[!0-9]*|0)
    echo "VPSMON_KEEP_UPGRADE_BACKUPS must be an integer from 1 to 20" >&2
    exit 2
    ;;
esac
if [ "$keep_upgrade_backups" -gt 20 ]; then
  echo "VPSMON_KEEP_UPGRADE_BACKUPS must be an integer from 1 to 20" >&2
  exit 2
fi

stage=$(readlink -f -- "$1")
case "$stage" in
  /tmp/vpsmon-stage.*) ;;
  *) echo "refusing stage path outside /tmp/vpsmon-stage.*" >&2; exit 2 ;;
esac

for required in vpsmon-agent config.json vpsmon-agent.service \
  vpsmon-nftables-snapshot.service vpsmon-nftables-snapshot.timer checksums.sha256; do
  if [ ! -f "$stage/$required" ] || [ -L "$stage/$required" ]; then
    echo "missing or unsafe staged file: $required" >&2
    exit 2
  fi
done

(
  cd "$stage"
  sha256sum -c checksums.sha256
)

for target in /opt/vpsmon/vpsmon-agent /etc/vpsmon/config.json /etc/systemd/system/vpsmon-agent.service; do
  if [ ! -f "$target" ] || [ -L "$target" ]; then
    echo "existing monitor path is missing or unsafe: $target" >&2
    exit 3
  fi
done

if ! getent passwd vpsmon >/dev/null 2>&1; then
  echo "existing vpsmon service account is missing" >&2
  exit 3
fi

existing_shell=$(getent passwd vpsmon | awk -F: '{print $7}')
case "$existing_shell" in
  /usr/sbin/nologin|/sbin/nologin|/bin/false) ;;
  *) echo "existing vpsmon user has an interactive shell; aborting" >&2; exit 3 ;;
esac

chmod 0755 "$stage/vpsmon-agent"
chmod 0600 "$stage/config.json"
chmod 0644 "$stage/vpsmon-agent.service"
chmod 0644 "$stage/vpsmon-nftables-snapshot.service"
chmod 0644 "$stage/vpsmon-nftables-snapshot.timer"

if ! "$stage/vpsmon-agent" --config "$stage/config.json" --dry-run >/dev/null; then
  echo "staged agent preflight failed" >&2
  exit 4
fi

if command -v systemd-analyze >/dev/null 2>&1; then
  if ! systemd-analyze verify \
    "$stage/vpsmon-agent.service" \
    "$stage/vpsmon-nftables-snapshot.service" \
    "$stage/vpsmon-nftables-snapshot.timer" >/dev/null 2>&1; then
    echo "staged systemd unit verification failed" >&2
    exit 4
  fi
fi

new_services=$("$stage/vpsmon-agent" --config "$stage/config.json" --list-services)
if old_services=$(/opt/vpsmon/vpsmon-agent --config /etc/vpsmon/config.json --list-services 2>/dev/null); then
  :
else
  # Agent v1.0/v1.1 did not expose --list-services. The v3 converter requires
  # the new service metadata to exactly match the old configuration, so the
  # validated new list is also the complete protected list for that upgrade.
  if [ "${VPSMON_V3_CONVERTED:-}" != "1" ]; then
    echo "old Agent cannot list protected services; use the verified v3 conversion runner" >&2
    exit 4
  fi
  old_services=$new_services
fi
protected_services=$(printf '%s\n%s\n' "$old_services" "$new_services" | sed '/^$/d' | sort -u)

configured_service_fingerprints() {
  while IFS= read -r service; do
    [ -n "$service" ] || continue
    printf '%s=' "$service"
    systemctl show "$service" \
      --property=ActiveState,SubState,MainPID,ExecMainStartTimestampMonotonic \
      --value 2>/dev/null | tr '\n' '|'
    printf '\n'
  done
}

before_services=$(printf '%s\n' "$protected_services" | configured_service_fingerprints)
was_active=$(systemctl is-active vpsmon-agent.service 2>/dev/null || true)
was_enabled=$(systemctl is-enabled vpsmon-agent.service 2>/dev/null || true)
snapshot_service_existed=0
snapshot_timer_existed=0
snapshot_file_existed=0
[ ! -f /etc/systemd/system/vpsmon-nftables-snapshot.service ] || snapshot_service_existed=1
[ ! -f /etc/systemd/system/vpsmon-nftables-snapshot.timer ] || snapshot_timer_existed=1
[ ! -f /var/lib/vpsmon/nftables-counters.json ] || snapshot_file_existed=1
snapshot_timer_was_active=$(systemctl is-active vpsmon-nftables-snapshot.timer 2>/dev/null || true)
snapshot_timer_was_enabled=$(systemctl is-enabled vpsmon-nftables-snapshot.timer 2>/dev/null || true)
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup="/var/lib/vpsmon/upgrade-backup.$stamp"
install -d -o root -g root -m 0700 "$backup"
cp -p -- /opt/vpsmon/vpsmon-agent "$backup/vpsmon-agent"
cp -p -- /etc/vpsmon/config.json "$backup/config.json"
cp -p -- /etc/systemd/system/vpsmon-agent.service "$backup/vpsmon-agent.service"
if [ "$snapshot_service_existed" = "1" ]; then
  cp -p -- /etc/systemd/system/vpsmon-nftables-snapshot.service "$backup/vpsmon-nftables-snapshot.service"
fi
if [ "$snapshot_timer_existed" = "1" ]; then
  cp -p -- /etc/systemd/system/vpsmon-nftables-snapshot.timer "$backup/vpsmon-nftables-snapshot.timer"
fi
if [ "$snapshot_file_existed" = "1" ]; then
  cp -p -- /var/lib/vpsmon/nftables-counters.json "$backup/nftables-counters.json"
fi
(
  cd "$backup"
  set -- vpsmon-agent config.json vpsmon-agent.service
  [ ! -f vpsmon-nftables-snapshot.service ] || set -- "$@" vpsmon-nftables-snapshot.service
  [ ! -f vpsmon-nftables-snapshot.timer ] || set -- "$@" vpsmon-nftables-snapshot.timer
  [ ! -f nftables-counters.json ] || set -- "$@" nftables-counters.json
  sha256sum "$@" > checksums.sha256
)

rollback() {
  echo "upgrade validation failed; restoring monitor backup" >&2
  systemctl stop vpsmon-agent.service >/dev/null 2>&1 || true
  systemctl disable --now vpsmon-nftables-snapshot.timer >/dev/null 2>&1 || true
  systemctl stop vpsmon-nftables-snapshot.service >/dev/null 2>&1 || true
  install -o root -g root -m 0755 "$backup/vpsmon-agent" /opt/vpsmon/vpsmon-agent
  install -o root -g vpsmon -m 0640 "$backup/config.json" /etc/vpsmon/config.json
  install -o root -g root -m 0644 "$backup/vpsmon-agent.service" /etc/systemd/system/vpsmon-agent.service
  if [ "$snapshot_service_existed" = "1" ]; then
    install -o root -g root -m 0644 "$backup/vpsmon-nftables-snapshot.service" /etc/systemd/system/vpsmon-nftables-snapshot.service
  else
    rm -f -- /etc/systemd/system/vpsmon-nftables-snapshot.service
  fi
  if [ "$snapshot_timer_existed" = "1" ]; then
    install -o root -g root -m 0644 "$backup/vpsmon-nftables-snapshot.timer" /etc/systemd/system/vpsmon-nftables-snapshot.timer
  else
    rm -f -- /etc/systemd/system/vpsmon-nftables-snapshot.timer
  fi
  if [ "$snapshot_file_existed" = "1" ]; then
    cp -p -- "$backup/nftables-counters.json" /var/lib/vpsmon/nftables-counters.json
  else
    rm -f -- /var/lib/vpsmon/nftables-counters.json
  fi
  systemctl daemon-reload >/dev/null 2>&1 || true
  if [ "$was_enabled" = "enabled" ]; then
    systemctl enable vpsmon-agent.service >/dev/null 2>&1 || true
  else
    systemctl disable vpsmon-agent.service >/dev/null 2>&1 || true
  fi
  if [ "$was_active" = "active" ]; then
    systemctl start vpsmon-agent.service >/dev/null 2>&1 || true
  fi
  if [ "$snapshot_timer_was_enabled" = "enabled" ]; then
    systemctl enable vpsmon-nftables-snapshot.timer >/dev/null 2>&1 || true
  else
    systemctl disable vpsmon-nftables-snapshot.timer >/dev/null 2>&1 || true
  fi
  if [ "$snapshot_timer_was_active" = "active" ]; then
    systemctl start vpsmon-nftables-snapshot.timer >/dev/null 2>&1 || true
  else
    systemctl stop vpsmon-nftables-snapshot.timer >/dev/null 2>&1 || true
  fi
}

systemctl stop vpsmon-nftables-snapshot.timer >/dev/null 2>&1 || true
systemctl stop vpsmon-nftables-snapshot.service >/dev/null 2>&1 || true
systemctl stop vpsmon-agent.service
if ! install -o root -g root -m 0755 "$stage/vpsmon-agent" /opt/vpsmon/vpsmon-agent ||
   ! install -o root -g vpsmon -m 0640 "$stage/config.json" /etc/vpsmon/config.json ||
   ! install -o root -g root -m 0644 "$stage/vpsmon-agent.service" /etc/systemd/system/vpsmon-agent.service ||
   ! install -o root -g root -m 0644 "$stage/vpsmon-nftables-snapshot.service" /etc/systemd/system/vpsmon-nftables-snapshot.service ||
   ! install -o root -g root -m 0644 "$stage/vpsmon-nftables-snapshot.timer" /etc/systemd/system/vpsmon-nftables-snapshot.timer; then
  rollback
  exit 5
fi

systemctl daemon-reload
configured_counters=$("$stage/vpsmon-agent" --config "$stage/config.json" --list-nftables-counters)
if [ -n "$configured_counters" ]; then
  if ! command -v nft >/dev/null 2>&1 ||
     ! systemctl enable --now vpsmon-nftables-snapshot.timer >/dev/null ||
     ! systemctl start vpsmon-nftables-snapshot.service; then
    rollback
    exit 5
  fi
else
  systemctl disable --now vpsmon-nftables-snapshot.timer >/dev/null 2>&1 || true
  systemctl stop vpsmon-nftables-snapshot.service >/dev/null 2>&1 || true
  rm -f -- /var/lib/vpsmon/nftables-counters.json
fi
if [ "$was_enabled" = "enabled" ]; then
  if ! systemctl enable vpsmon-agent.service >/dev/null; then
    rollback
    exit 5
  fi
else
  systemctl disable vpsmon-agent.service >/dev/null 2>&1 || true
fi

if [ "$was_active" = "active" ]; then
  if ! systemctl start vpsmon-agent.service; then
    rollback
    exit 5
  fi
  sleep 3
  if [ "$(systemctl is-active vpsmon-agent.service 2>/dev/null || true)" != "active" ]; then
    rollback
    exit 5
  fi
fi

after_services=$(printf '%s\n' "$protected_services" | configured_service_fingerprints)
if [ "$before_services" != "$after_services" ]; then
  rollback
  exit 6
fi

if pruned_backups=$(prune_upgrade_backups /var/lib/vpsmon "$keep_upgrade_backups"); then
  :
else
  pruned_backups="warning: automatic backup pruning failed"
fi

echo "vpsmon-agent upgraded successfully"
echo "protected service fingerprints unchanged"
echo "previous_version=$($backup/vpsmon-agent --version 2>/dev/null || echo unknown)"
echo "current_version=$(/opt/vpsmon/vpsmon-agent --version 2>/dev/null || echo unknown)"
echo "rollback_backup=$backup"
echo "retained_upgrade_backups=$keep_upgrade_backups"
echo "pruned_upgrade_backups=$pruned_backups"
echo "agent_state=$(systemctl is-active vpsmon-agent.service 2>/dev/null || true)"
echo "nftables_counter_timer=$(systemctl is-active vpsmon-nftables-snapshot.timer 2>/dev/null || true)"
