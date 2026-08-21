#!/bin/sh
set -eu

umask 077

if [ "$(id -u)" -ne 0 ]; then
  echo "upgrade-agent.sh must run as root" >&2
  exit 1
fi

if [ "$#" -ne 1 ]; then
  echo "usage: upgrade-agent.sh /tmp/vpsmon-stage.ID" >&2
  exit 2
fi

stage=$(readlink -f -- "$1")
case "$stage" in
  /tmp/vpsmon-stage.*) ;;
  *) echo "refusing stage path outside /tmp/vpsmon-stage.*" >&2; exit 2 ;;
esac

for required in vpsmon-agent config.json vpsmon-agent.service checksums.sha256; do
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

if ! "$stage/vpsmon-agent" --config "$stage/config.json" --dry-run >/dev/null; then
  echo "staged agent preflight failed" >&2
  exit 4
fi

if command -v systemd-analyze >/dev/null 2>&1; then
  if ! systemd-analyze verify "$stage/vpsmon-agent.service" >/dev/null 2>&1; then
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
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup="/var/lib/vpsmon/upgrade-backup.$stamp"
install -d -o root -g root -m 0700 "$backup"
cp -p -- /opt/vpsmon/vpsmon-agent "$backup/vpsmon-agent"
cp -p -- /etc/vpsmon/config.json "$backup/config.json"
cp -p -- /etc/systemd/system/vpsmon-agent.service "$backup/vpsmon-agent.service"
(
  cd "$backup"
  sha256sum vpsmon-agent config.json vpsmon-agent.service > checksums.sha256
)

rollback() {
  echo "upgrade validation failed; restoring monitor backup" >&2
  systemctl stop vpsmon-agent.service >/dev/null 2>&1 || true
  install -o root -g root -m 0755 "$backup/vpsmon-agent" /opt/vpsmon/vpsmon-agent
  install -o root -g vpsmon -m 0640 "$backup/config.json" /etc/vpsmon/config.json
  install -o root -g root -m 0644 "$backup/vpsmon-agent.service" /etc/systemd/system/vpsmon-agent.service
  systemctl daemon-reload >/dev/null 2>&1 || true
  if [ "$was_enabled" = "enabled" ]; then
    systemctl enable vpsmon-agent.service >/dev/null 2>&1 || true
  else
    systemctl disable vpsmon-agent.service >/dev/null 2>&1 || true
  fi
  if [ "$was_active" = "active" ]; then
    systemctl start vpsmon-agent.service >/dev/null 2>&1 || true
  fi
}

systemctl stop vpsmon-agent.service
if ! install -o root -g root -m 0755 "$stage/vpsmon-agent" /opt/vpsmon/vpsmon-agent ||
   ! install -o root -g vpsmon -m 0640 "$stage/config.json" /etc/vpsmon/config.json ||
   ! install -o root -g root -m 0644 "$stage/vpsmon-agent.service" /etc/systemd/system/vpsmon-agent.service; then
  rollback
  exit 5
fi

systemctl daemon-reload
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

echo "vpsmon-agent upgraded successfully"
echo "protected service fingerprints unchanged"
echo "previous_version=$($backup/vpsmon-agent --version 2>/dev/null || echo unknown)"
echo "current_version=$(/opt/vpsmon/vpsmon-agent --version 2>/dev/null || echo unknown)"
echo "rollback_backup=$backup"
echo "agent_state=$(systemctl is-active vpsmon-agent.service 2>/dev/null || true)"
