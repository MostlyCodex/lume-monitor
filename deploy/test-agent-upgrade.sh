#!/bin/sh
# Exercise the real upgrade/rollback flow in a fixture, without root or systemd.
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
test_root=$(mktemp -d /tmp/lume-upgrade-test.XXXXXX)
stage=$(mktemp -d /tmp/vpsmon-stage.test.XXXXXX)
cleanup() {
  for path in "$test_root" "$stage"; do
    resolved=$(readlink -f -- "$path")
    [ "$resolved" = "$path" ] || exit 1
    case "$resolved" in
      /tmp/lume-upgrade-test.*|/tmp/vpsmon-stage.test.*) rm -rf -- "$resolved" ;;
      *) exit 1 ;;
    esac
  done
}
trap cleanup EXIT HUP INT TERM
mkdir "$test_root/bin"
cat > "$test_root/bin/id" <<'EOF'
#!/bin/sh
echo 0
EOF
cat > "$test_root/bin/getent" <<'EOF'
#!/bin/sh
echo 'vpsmon:x:123:123::/var/lib/vpsmon:/usr/sbin/nologin'
EOF
cat > "$test_root/bin/systemctl" <<'EOF'
#!/bin/sh
set -eu
printf '%s\n' "$*" >> "$FIXTURE/systemctl.log"
command=$1
shift
case "$command" in
  show) printf 'active\nrunning\n123\n456\n'; exit 0 ;;
  daemon-reload) exit 0 ;;
  is-active)
    if [ -f "$FIXTURE/state/$1.active" ]; then echo active; else echo inactive; exit 3; fi
    exit 0 ;;
  is-enabled)
    if [ -f "$FIXTURE/state/$1.enabled" ]; then echo enabled; else echo disabled; exit 1; fi
    exit 0 ;;
esac
now=0
for unit in "$@"; do
  case "$unit" in --now) now=1; continue ;; -*) continue ;; esac
  case "$unit" in nftables.service) echo 'business service was modified' >&2; exit 99 ;; esac
  case "$command" in
    start)
      if [ "$unit" = vpsmon-agent.service ] && [ -f "$FIXTURE/fail-start" ]; then
        rm "$FIXTURE/fail-start"
        exit 1
      fi
      touch "$FIXTURE/state/$unit.active" ;;
    stop) rm -f "$FIXTURE/state/$unit.active" ;;
    enable) touch "$FIXTURE/state/$unit.enabled" ;;
    disable)
      rm -f "$FIXTURE/state/$unit.enabled"
      [ "$now" = 0 ] || rm -f "$FIXTURE/state/$unit.active" ;;
    *) exit 98 ;;
  esac
done
EOF
for command in sleep systemd-analyze; do
  printf '#!/bin/sh\nexit 0\n' > "$test_root/bin/$command"
done
chmod +x "$test_root/bin/"*
# Unix ownership/mode changes are outside this service-lifecycle fixture.
# Copy through a shim so the same rollback test also runs under Git Bash.
cat > "$test_root/bin/install" <<'EOF'
#!/bin/sh
set -eu
directory=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    -d) directory=1; shift ;;
    -m|-o|-g) shift 2 ;;
    *) break ;;
  esac
done
if [ "$directory" = 1 ]; then mkdir -p "$@"; else cp "$@"; fi
EOF
chmod +x "$test_root/bin/install"
export PATH="$test_root/bin:$PATH"

for scenario in success rollback; do
  FIXTURE="$test_root/$scenario"
  export FIXTURE
  mkdir -p "$FIXTURE/opt/vpsmon" "$FIXTURE/etc/vpsmon" "$FIXTURE/etc/systemd/system" "$FIXTURE/var/lib/vpsmon" "$FIXTURE/state"
  for version in old new; do
    cat > "$FIXTURE/$version-agent" <<EOF
#!/bin/sh
case "\$*" in
  *--version*) echo $version ;;
  *--list-services*) echo nftables.service ;;
  *--dry-run*) exit 0 ;;
  *) exit 2 ;;
esac
EOF
    chmod 755 "$FIXTURE/$version-agent"
  done
  cp "$FIXTURE/old-agent" "$FIXTURE/opt/vpsmon/vpsmon-agent"
  echo old-config > "$FIXTURE/etc/vpsmon/config.json"
  for unit in vpsmon-agent.service vpsmon-nftables-snapshot.service vpsmon-nftables-snapshot.timer; do
    echo "$unit old" > "$FIXTURE/etc/systemd/system/$unit"
    touch "$FIXTURE/state/$unit.active" "$FIXTURE/state/$unit.enabled"
  done
  echo old-snapshot > "$FIXTURE/var/lib/vpsmon/nftables-counters.json"
  touch "$FIXTURE/state/nftables.service.active" "$FIXTURE/state/nftables.service.enabled"
  cp "$FIXTURE/new-agent" "$stage/vpsmon-agent"
  echo new-config > "$stage/config.json"
  echo new-unit > "$stage/vpsmon-agent.service"
  (cd "$stage" && sha256sum vpsmon-agent config.json vpsmon-agent.service > checksums.sha256)

  # Redirect only fixed monitor paths; retain the real stage validation,
  # checksums, backup, service ordering, state restoration and rollback logic.
  sed -e "s#/opt/vpsmon#$FIXTURE/opt/vpsmon#g" \
      -e "s#/etc/vpsmon#$FIXTURE/etc/vpsmon#g" \
      -e "s#/etc/systemd/system#$FIXTURE/etc/systemd/system#g" \
      -e "s#/var/lib/vpsmon#$FIXTURE/var/lib/vpsmon#g" \
      -e 's/ -o root -g root//g' -e 's/ -o root -g vpsmon//g' \
      "$script_dir/upgrade-agent.sh" > "$FIXTURE/upgrade.sh"
  status=0
  [ "$scenario" != rollback ] || touch "$FIXTURE/fail-start"
  sh "$FIXTURE/upgrade.sh" "$stage" > "$FIXTURE/output.log" 2>&1 || status=$?
  if [ "$scenario" = success ]; then
    if [ "$status" != 0 ]; then cat "$FIXTURE/output.log"; exit 1; fi
    cmp "$FIXTURE/new-agent" "$FIXTURE/opt/vpsmon/vpsmon-agent"
    [ "$(cat "$FIXTURE/etc/vpsmon/config.json")" = new-config ]
    [ ! -f "$FIXTURE/etc/systemd/system/vpsmon-nftables-snapshot.service" ]
    [ ! -f "$FIXTURE/etc/systemd/system/vpsmon-nftables-snapshot.timer" ]
    [ ! -f "$FIXTURE/var/lib/vpsmon/nftables-counters.json" ]
    [ ! -f "$FIXTURE/state/vpsmon-nftables-snapshot.timer.active" ]
    [ ! -f "$FIXTURE/state/vpsmon-nftables-snapshot.timer.enabled" ]
  else
    if [ "$status" != 5 ]; then cat "$FIXTURE/output.log"; exit 1; fi
    cmp "$FIXTURE/old-agent" "$FIXTURE/opt/vpsmon/vpsmon-agent"
    [ "$(cat "$FIXTURE/etc/vpsmon/config.json")" = old-config ]
    [ "$(cat "$FIXTURE/var/lib/vpsmon/nftables-counters.json")" = old-snapshot ]
    [ "$(cat "$FIXTURE/etc/systemd/system/vpsmon-nftables-snapshot.service")" = 'vpsmon-nftables-snapshot.service old' ]
    [ "$(cat "$FIXTURE/etc/systemd/system/vpsmon-nftables-snapshot.timer")" = 'vpsmon-nftables-snapshot.timer old' ]
    [ -f "$FIXTURE/state/vpsmon-nftables-snapshot.timer.active" ]
    [ -f "$FIXTURE/state/vpsmon-nftables-snapshot.timer.enabled" ]
  fi
  [ -f "$FIXTURE/state/vpsmon-agent.service.active" ]
  [ -f "$FIXTURE/state/vpsmon-agent.service.enabled" ]
  [ -f "$FIXTURE/state/nftables.service.active" ]
  [ -f "$FIXTURE/state/nftables.service.enabled" ]
  echo "Agent upgrade $scenario passed; business service unchanged"
done
