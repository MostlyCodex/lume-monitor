#!/bin/sh
# Execute the real uninstaller in a mapped filesystem with fake account/systemd
# commands. No test command may touch a real Agent or a real service account.
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
test_root=$(mktemp -d /tmp/lume-uninstall-test.XXXXXX)
cleanup() {
  resolved=$(readlink -f -- "$test_root")
  case "$resolved" in /tmp/lume-uninstall-test.*) rm -rf -- "$resolved" ;; *) exit 1 ;; esac
}
trap cleanup EXIT HUP INT TERM
mkdir "$test_root/bin"
printf '#!/bin/sh\necho 0\n' > "$test_root/bin/id"
cat > "$test_root/bin/getent" <<'EOF'
#!/bin/sh
case "$1" in
  passwd) [ -f "$FIXTURE/account" ] || exit 2; cat "$FIXTURE/account" ;;
  group) [ -f "$FIXTURE/group" ] || exit 2; echo 'vpsmon:x:990:' ;;
  *) exit 2 ;;
esac
EOF
cat > "$test_root/bin/userdel" <<'EOF'
#!/bin/sh
[ "$*" = vpsmon ] || exit 7
rm -f "$FIXTURE/account"
EOF
cat > "$test_root/bin/groupdel" <<'EOF'
#!/bin/sh
[ "$*" = vpsmon ] || exit 7
rm -f "$FIXTURE/group"
EOF
cat > "$test_root/bin/pgrep" <<'EOF'
#!/bin/sh
[ "$*" = '-u vpsmon' ] || exit 7
[ -f "$FIXTURE/busy" ]
EOF
cat > "$test_root/bin/systemctl" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "$FIXTURE/systemctl.log"
case "$*" in *nftables.service*) exit 99 ;; esac
case "$1" in
  disable|stop) [ -f "$FIXTURE/fail-stop" ] || rm -f "$FIXTURE/active" ;;
  is-active) [ ! -f "$FIXTURE/active" ] || { echo active; exit 0; }; echo inactive; exit 3 ;;
esac
EOF
chmod +x "$test_root/bin/"*
export PATH="$test_root/bin:$PATH"
for scenario in complete wrong-node busy fail-stop interactive redirected; do
  FIXTURE="$test_root/$scenario"; export FIXTURE
  mkdir -p "$FIXTURE/etc/vpsmon" "$FIXTURE/opt/vpsmon" "$FIXTURE/var/lib/vpsmon/spool" \
    "$FIXTURE/var/lib/vpsmon/upgrade-backup.old" "$FIXTURE/etc/systemd/system/vpsmon-agent.service.d" \
    "$FIXTURE/etc/systemd/system/multi-user.target.wants" "$FIXTURE/unrelated"
  printf '%s\n' 'fixture-secret' > "$FIXTURE/etc/vpsmon/config.json"
  cat > "$FIXTURE/opt/vpsmon/vpsmon-agent" <<'EOF'
#!/bin/sh
printf '{\n  "node_id": "alpha"\n}\n'
EOF
  chmod +x "$FIXTURE/opt/vpsmon/vpsmon-agent"
  printf '%s\n' "vpsmon:x:990:990::${FIXTURE}/var/lib/vpsmon:/usr/sbin/nologin" > "$FIXTURE/account"
  touch "$FIXTURE/group" "$FIXTURE/active" "$FIXTURE/var/lib/vpsmon/spool/report.json" \
    "$FIXTURE/var/lib/vpsmon/pending.json" "$FIXTURE/var/lib/vpsmon/traffic.json" \
    "$FIXTURE/var/lib/vpsmon/upgrade-backup.old/config.json" \
    "$FIXTURE/etc/systemd/system/vpsmon-agent.service.d/override.conf" \
    "$FIXTURE/etc/systemd/system/vpsmon-agent.service" \
    "$FIXTURE/etc/systemd/system/nftables.service" "$FIXTURE/unrelated/keep"
  printf '%s\n' alpha > "$FIXTURE/expected-node-id"
  case "$scenario" in
    wrong-node) echo beta > "$FIXTURE/expected-node-id" ;;
    busy|fail-stop) touch "$FIXTURE/$scenario" ;;
    interactive) sed 's#/usr/sbin/nologin#/bin/sh#' "$FIXTURE/account" > "$FIXTURE/interactive"; mv "$FIXTURE/interactive" "$FIXTURE/account" ;;
    redirected)
      case "$(uname -s)" in MINGW*|MSYS*) echo 'Uninstall symlink guard requires native Linux links'; continue ;; esac
      mv "$FIXTURE/var/lib/vpsmon" "$FIXTURE/var/lib/keep-state"
      ln -s keep-state "$FIXTURE/var/lib/vpsmon"
      ;;
  esac
  sed -e "s#/opt/vpsmon#$FIXTURE/opt/vpsmon#g" -e "s#/etc/vpsmon#$FIXTURE/etc/vpsmon#g" \
    -e "s#/var/lib/vpsmon#$FIXTURE/var/lib/vpsmon#g" -e "s#/etc/systemd/system#$FIXTURE/etc/systemd/system#g" \
    "$script_dir/uninstall-agent.sh" > "$FIXTURE/uninstall.sh"
  result=0
  sh "$FIXTURE/uninstall.sh" --confirm "$FIXTURE/expected-node-id" > "$FIXTURE/output" 2>&1 || result=$?
  if [ "$scenario" = complete ]; then
    if [ "$result" != 0 ]; then cat "$FIXTURE/output"; exit 1; fi
    for path in etc/vpsmon opt/vpsmon var/lib/vpsmon etc/systemd/system/vpsmon-agent.service.d account group; do [ ! -e "$FIXTURE/$path" ]; done
    # An interrupted caller can repeat the uninstall after all files are gone.
    sh "$FIXTURE/uninstall.sh" --confirm "$FIXTURE/expected-node-id" >> "$FIXTURE/output" 2>&1
  else
    if [ "$result" = 0 ]; then echo "expected refusal: $scenario"; exit 1; fi
    [ -f "$FIXTURE/etc/vpsmon/config.json" ]
    [ -f "$FIXTURE/account" ]
    if [ "$scenario" = redirected ]; then [ -f "$FIXTURE/var/lib/keep-state/spool/report.json" ]; fi
  fi
  [ -f "$FIXTURE/unrelated/keep" ]
  [ -f "$FIXTURE/etc/systemd/system/nftables.service" ]
  if grep -q fixture-secret "$FIXTURE/output"; then echo 'secret leaked'; exit 1; fi
  echo "Agent permanent uninstall $scenario passed"
done
