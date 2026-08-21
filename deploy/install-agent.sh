#!/bin/sh
set -eu

umask 077

if [ "$(id -u)" -ne 0 ]; then
  echo "install-agent.sh must run as root" >&2
  exit 1
fi

if [ "$#" -ne 1 ]; then
  echo "usage: install-agent.sh /tmp/vpsmon-stage.ID" >&2
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
  if [ -e "$target" ] || [ -L "$target" ]; then
    echo "refusing to overwrite existing path: $target" >&2
    exit 3
  fi
done

if getent passwd vpsmon >/dev/null 2>&1; then
  existing_shell=$(getent passwd vpsmon | awk -F: '{print $7}')
  case "$existing_shell" in
    /usr/sbin/nologin|/sbin/nologin|/bin/false) ;;
    *) echo "existing vpsmon user has an interactive shell; aborting" >&2; exit 3 ;;
  esac
else
  useradd --system --home-dir /var/lib/vpsmon --shell /usr/sbin/nologin --user-group vpsmon
fi

configured_service_fingerprints() {
  while IFS= read -r service; do
    [ -n "$service" ] || continue
    printf '%s=' "$service"
    systemctl show "$service" --property=ActiveState,SubState,MainPID,ExecMainStartTimestampMonotonic --value 2>/dev/null | tr '\n' '|'
    printf '\n'
  done
}

install -d -o root -g root -m 0755 /opt/vpsmon
install -d -o root -g vpsmon -m 0750 /etc/vpsmon
install -o root -g root -m 0755 "$stage/vpsmon-agent" /opt/vpsmon/vpsmon-agent
install -o root -g vpsmon -m 0640 "$stage/config.json" /etc/vpsmon/config.json
install -o root -g root -m 0644 "$stage/vpsmon-agent.service" /etc/systemd/system/vpsmon-agent.service

configured_services=$(/opt/vpsmon/vpsmon-agent --config /etc/vpsmon/config.json --list-services)
before_services=$(printf '%s\n' "$configured_services" | configured_service_fingerprints)

rollback() {
  systemctl disable --now vpsmon-agent.service >/dev/null 2>&1 || true
  rm -f -- /etc/systemd/system/vpsmon-agent.service /etc/vpsmon/config.json /opt/vpsmon/vpsmon-agent
  rmdir -- /etc/vpsmon /opt/vpsmon >/dev/null 2>&1 || true
  systemctl daemon-reload >/dev/null 2>&1 || true
}

if ! /opt/vpsmon/vpsmon-agent --config /etc/vpsmon/config.json --dry-run >/dev/null; then
  echo "agent preflight failed; rolling back only newly installed monitor files" >&2
  rollback
  exit 4
fi

if command -v systemd-analyze >/dev/null 2>&1; then
  if ! systemd-analyze verify /etc/systemd/system/vpsmon-agent.service >/dev/null 2>&1; then
    echo "systemd unit verification failed; rolling back" >&2
    rollback
    exit 4
  fi
fi

systemctl daemon-reload
if ! systemctl enable --now vpsmon-agent.service; then
  echo "new monitor service failed to start; rolling back" >&2
  rollback
  exit 5
fi

sleep 3
if [ "$(systemctl is-active vpsmon-agent.service 2>/dev/null || true)" != "active" ]; then
  echo "new monitor service is not active; rolling back" >&2
  rollback
  exit 5
fi

after_services=$(printf '%s\n' "$configured_services" | configured_service_fingerprints)
if [ "$before_services" != "$after_services" ]; then
  echo "protected service state changed unexpectedly; rolling back monitor only" >&2
  rollback
  exit 6
fi

rm -f -- "$stage/config.json"

echo "vpsmon-agent installed successfully"
echo "protected service fingerprints unchanged"
echo "agent_state=$(systemctl is-active vpsmon-agent.service)"
