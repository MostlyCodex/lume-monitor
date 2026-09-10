#!/bin/sh
# Execute the real audit wrapper against an isolated filesystem and fake systemd.
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
test_root=$(mktemp -d /tmp/lume-audit-test.XXXXXX)
stage=$(mktemp -d /tmp/vpsmon-stage.test.XXXXXX)
cleanup() {
  for target in "$test_root" "$stage"; do
    resolved=$(readlink -f -- "$target")
    case "$resolved" in
      /tmp/lume-audit-test.*|/tmp/vpsmon-stage.test.*) rm -rf -- "$resolved" ;;
      *) exit 1 ;;
    esac
  done
}
trap cleanup EXIT HUP INT TERM
mkdir "$test_root/bin"
printf '#!/bin/sh\necho 0\n' > "$test_root/bin/id"
cat > "$test_root/bin/systemctl" <<'EOF'
#!/bin/sh
case "$1" in
  is-active) [ ! -f "$FIXTURE/active" ] || { echo active; exit 0; }; echo inactive; exit 3 ;;
  is-enabled) [ ! -f "$FIXTURE/enabled" ] || { echo enabled; exit 0; }; echo disabled; exit 1 ;;
  enable) touch "$FIXTURE/enabled" "$FIXTURE/active" ;;
  disable)
    [ "${3:-}" != vpsmon-agent.service ] || rm -f "$FIXTURE/enabled" "$FIXTURE/active" "$FIXTURE/etc/systemd/system/multi-user.target.wants/vpsmon-agent.service"
    ;;
esac
EOF
chmod +x "$test_root/bin/"*
export PATH="$test_root/bin:$PATH"

for scenario in install modify attributes unchanged rollback partial uninstall stop; do
  if [ "$scenario" = attributes ]; then
    case "$(uname -s)" in MINGW*|MSYS*) echo "Agent audit attributes: POSIX modes require Linux"; continue ;; esac
  fi
  FIXTURE="$test_root/$scenario"
  export FIXTURE
  mkdir -p "$FIXTURE/opt/vpsmon" "$FIXTURE/etc/vpsmon" "$FIXTURE/etc/systemd/system/multi-user.target.wants" "$FIXTURE/var/lib/vpsmon"
  for file in passwd group shadow gshadow subuid subgid; do
    printf 'root:fixture\nvpsmon:fixture-secret-account\n' > "$FIXTURE/etc/$file"
  done
  if [ "$scenario" != install ]; then
    printf 'a\nfixture-secret-old\nc\nkeep\ne\n' > "$FIXTURE/etc/vpsmon/config.json"
    printf '[Unit]\nDescription=old\n' > "$FIXTURE/etc/systemd/system/vpsmon-agent.service"
    printf '\177ELF\000old' > "$FIXTURE/opt/vpsmon/vpsmon-agent"
    ln -s ../vpsmon-agent.service "$FIXTURE/etc/systemd/system/multi-user.target.wants/vpsmon-agent.service"
    touch "$FIXTURE/active" "$FIXTURE/enabled"
    chmod 0600 "$FIXTURE/etc/vpsmon/config.json"
  fi
  cat > "$stage/upgrade-agent.sh" <<'EOF'
#!/bin/sh
case "$SCENARIO" in
  modify|partial)
    printf 'a\nfixture-secret-new\nc\nkeep\n' > "$FIXTURE/etc/vpsmon/config.json"
    [ "$SCENARIO" != partial ] || exit 7
    printf '\177ELF\000new' > "$FIXTURE/opt/vpsmon/vpsmon-agent"
    mkdir "$FIXTURE/var/lib/vpsmon/upgrade-backup.20260910T120000Z"
    ;;
  attributes) chmod 0644 "$FIXTURE/etc/vpsmon/config.json" ;;
  rollback)
    printf 'temporary-secret\n' > "$FIXTURE/etc/vpsmon/config.json"
    printf 'a\nfixture-secret-old\nc\nkeep\ne\n' > "$FIXTURE/etc/vpsmon/config.json"
    exit 5 ;;
esac
EOF
  cat > "$stage/install-agent.sh" <<'EOF'
#!/bin/sh
printf 'first\nfixture-secret\nlast\n' > "$FIXTURE/etc/vpsmon/config.json"
printf '[Unit]\nDescription=new\n' > "$FIXTURE/etc/systemd/system/vpsmon-agent.service"
printf '\177ELF\000new' > "$FIXTURE/opt/vpsmon/vpsmon-agent"
EOF
  cat > "$stage/uninstall-agent.sh" <<'EOF'
#!/bin/sh
rm -f "$FIXTURE/etc/vpsmon/config.json" "$FIXTURE/etc/systemd/system/vpsmon-agent.service" "$FIXTURE/opt/vpsmon/vpsmon-agent" "$FIXTURE/etc/systemd/system/multi-user.target.wants/vpsmon-agent.service" "$FIXTURE/active" "$FIXTURE/enabled"
for file in passwd group shadow gshadow subuid subgid; do
  sed '/^vpsmon:/d' "$FIXTURE/etc/$file" > "$FIXTURE/etc/$file.new"
  mv "$FIXTURE/etc/$file.new" "$FIXTURE/etc/$file"
done
EOF
  sed -e "s#/opt/vpsmon#$FIXTURE/opt/vpsmon#g" -e "s#/etc/vpsmon#$FIXTURE/etc/vpsmon#g" \
      -e "s#/etc/systemd/system#$FIXTURE/etc/systemd/system#g" -e "s#/var/lib/vpsmon#$FIXTURE/var/lib/vpsmon#g" \
      -e "s#/etc/passwd#$FIXTURE/etc/passwd#g" \
      -e "s#/etc/group#$FIXTURE/etc/group#g" \
      -e "s#/etc/shadow#$FIXTURE/etc/shadow#g" \
      -e "s#/etc/gshadow#$FIXTURE/etc/gshadow#g" \
      -e "s#/etc/subuid#$FIXTURE/etc/subuid#g" \
      -e "s#/etc/subgid#$FIXTURE/etc/subgid#g" \
      "$script_dir/audit-agent.sh" > "$stage/audit-agent.sh"
  native_link=0
  [ ! -L "$FIXTURE/etc/systemd/system/multi-user.target.wants/vpsmon-agent.service" ] || native_link=1
  action=upgrade
  case "$scenario" in install|uninstall|stop) action=$scenario ;; esac
  SCENARIO=$scenario; export SCENARIO
  result=0
  sh "$stage/audit-agent.sh" "$stage" "$action" > "$FIXTURE/output" 2>&1 || result=$?
  expected=0
  case "$scenario" in partial) expected=7 ;; rollback) expected=5 ;; esac
  if [ "$result" != "$expected" ]; then cat "$FIXTURE/output"; exit 1; fi
  report="$stage/changes.tsv"
  [ "$(head -n 1 "$report")" = LUME_CHANGES_V1 ]
  [ "$(tail -n 1 "$report")" = END ]
  [ ! -e "$stage/.changes-before" ]
  if grep -q secret "$report" "$FIXTURE/output"; then echo 'secret leaked'; exit 1; fi
  case "$scenario" in
    install) grep -Fx "$(printf 'added\t%s/etc/vpsmon/config.json\ttext\t-\t1-3' "$FIXTURE")" "$report" ;;
    modify|partial)
      grep -Fx "$(printf 'changed\t%s/etc/vpsmon/config.json\ttext\t2,5\t2' "$FIXTURE")" "$report"
      ;;
    attributes) grep -Fx "$(printf 'attributes\t%s/etc/vpsmon/config.json\ttext\t-\t-' "$FIXTURE")" "$report" ;;
    unchanged|rollback) [ "$(wc -l < "$report" | tr -d ' ')" = 2 ] ;;
    uninstall) grep -Fx "$(printf 'removed\t%s/etc/vpsmon/config.json\ttext\t1-5\t-' "$FIXTURE")" "$report"
      for file in passwd group shadow gshadow subuid subgid; do
        grep -Fx "$(printf 'entries\t%s/etc/%s\ttext\t2\t-' "$FIXTURE" "$file")" "$report"
      done
      ;;
    stop)
      if [ "$native_link" = 1 ]; then
        grep -Fx "$(printf 'removed\t%s/etc/systemd/system/multi-user.target.wants/vpsmon-agent.service\tlink\t-\t-' "$FIXTURE")" "$report"
      else echo "Agent audit symlink: native links require Linux"; fi
      grep -Fx "$(printf 'service\tvpsmon-agent.service\tactive/enabled\tinactive/disabled')" "$report"
      ;;
  esac
  echo "Agent audit $scenario passed"
done
