#!/bin/sh
# Audit only Lume-managed persistent files. Snapshots and diff contents stay
# root-only on the VPS; the CLI receives paths, line ranges and service states.
set -eu
umask 077

[ "$(id -u)" -eq 0 ] || { echo "run audit-agent.sh as root" >&2; exit 1; }
[ "$#" -ge 2 ] && [ "$#" -le 3 ] || exit 2
stage=$(readlink -f -- "$1")
case "$stage" in /tmp/vpsmon-stage.*) ;; *) exit 2 ;; esac
[ -d "$stage" ] || exit 2
action=$2
case "$action" in install|upgrade|uninstall|stop) ;; *) exit 2 ;; esac
activate=${3:-keep}
case "$activate" in keep|activate) ;; *) exit 2 ;; esac
for command in diff cmp stat awk; do
  command -v "$command" >/dev/null 2>&1 || { echo "missing required command: $command" >&2; exit 2; }
done

snapshot="$stage/.changes-before"
mkdir -m 700 "$snapshot"
report="$stage/changes.tsv"

paths() {
  printf '%s\n' /opt/vpsmon/vpsmon-agent /etc/vpsmon/config.json \
    /etc/systemd/system/vpsmon-agent.service \
    /etc/systemd/system/vpsmon-nftables-snapshot.service \
    /etc/systemd/system/vpsmon-nftables-snapshot.timer \
    /var/lib/vpsmon/nftables-counters.json
  find /etc/systemd/system -mindepth 2 -maxdepth 2 -type l \
    \( -name vpsmon-agent.service -o -name vpsmon-nftables-snapshot.service -o -name vpsmon-nftables-snapshot.timer \) -print
}
backups() {
  if [ -d /var/lib/vpsmon ]; then
    find /var/lib/vpsmon -mindepth 1 -maxdepth 1 -type d -name 'upgrade-backup.*' -print | LC_ALL=C sort
  fi
}
service_state() {
  active=$(systemctl is-active vpsmon-agent.service 2>/dev/null || true)
  enabled=$(systemctl is-enabled vpsmon-agent.service 2>/dev/null || true)
  printf '%s/%s' "${active:-unknown}" "${enabled:-unknown}"
}
full_range() {
  awk 'END { if (NR == 0) print "-"; else if (NR == 1) print "1"; else print "1-" NR }' "$1"
}
kind_of() {
  if [ -L "$1" ]; then printf link
  elif [ "${1##*/}" = vpsmon-agent ]; then printf binary
  else printf text; fi
}

paths | LC_ALL=C sort -u > "$snapshot/paths"
backups > "$snapshot/backups"
service_before=$(service_state)
while IFS= read -r path; do
  if [ -f "$path" ] || [ -L "$path" ]; then
    mkdir -p "$snapshot/files$(dirname -- "$path")"
    cp -pP -- "$path" "$snapshot/files$path"
  fi
done < "$snapshot/paths"

record_file() {
  path=$1
  old="$snapshot/files$path"
  old_exists=0; new_exists=0
  [ ! -f "$old" ] && [ ! -L "$old" ] || old_exists=1
  [ ! -f "$path" ] && [ ! -L "$path" ] || new_exists=1
  [ "$old_exists$new_exists" != 00 ] || return 0
  before=-; after=-
  if [ "$old_exists" = 0 ]; then
    change=added; kind=$(kind_of "$path")
    [ "$kind" != text ] || after=$(full_range "$path")
  elif [ "$new_exists" = 0 ]; then
    change=removed; kind=$(kind_of "$old")
    [ "$kind" != text ] || before=$(full_range "$old")
  else
    kind=$(kind_of "$path")
    old_kind=$(kind_of "$old")
    if [ "$kind" = link ] || [ "$old_kind" = link ]; then
      if [ "$kind" = "$old_kind" ] && [ "$(readlink -- "$old")" = "$(readlink -- "$path")" ]; then return 0; fi
      change=changed; kind=link
    elif cmp -s -- "$old" "$path"; then
      [ "$(stat -c '%a:%u:%g' -- "$old")" != "$(stat -c '%a:%u:%g' -- "$path")" ] || return 0
      change=attributes
    else
      change=changed
      if [ "$kind" = text ]; then
        # Unified hunk headers contain line numbers only. Never send diff text.
        diff_status=0
        diff -a -U 0 -- "$old" "$path" > "$snapshot/diff" || diff_status=$?
        [ "$diff_status" -le 1 ] || return 1
        ranges=$(awk '
          function range(value, pieces, count) {
            sub(/^[+-]/, "", value); count=split(value,pieces,",");
            if (count == 2 && pieces[2] == 0) return "";
            return count == 1 || pieces[2] == 1 ? pieces[1] : pieces[1] "-" (pieces[1]+pieces[2]-1);
          }
          /^@@ / {
            a=range($2); b=range($3);
            if (a != "") old=old (old == "" ? "" : ",") a;
            if (b != "") new=new (new == "" ? "" : ",") b;
          }
          END { printf "%s\t%s", old == "" ? "-" : old, new == "" ? "-" : new }
        ' "$snapshot/diff")
        printf '%s\t%s\t%s\t%s\n' "$change" "$path" "$kind" "$ranges"
        return 0
      fi
    fi
  fi
  printf '%s\t%s\t%s\t%s\t%s\n' "$change" "$path" "$kind" "$before" "$after"
}

finish() {
  result=$?
  trap - 0 HUP INT TERM
  set +e
  # Build an atomic, complete metadata report even when the action rolled back.
  # A missing END marker is treated as unavailable, never as an empty change set.
  (
    set -e
    printf 'LUME_CHANGES_V1\n'
    paths >> "$snapshot/paths"
    LC_ALL=C sort -u "$snapshot/paths" > "$snapshot/all-paths"
    while IFS= read -r path; do record_file "$path"; done < "$snapshot/all-paths"
    backups > "$snapshot/after-backups"
    while IFS= read -r path; do
      grep -Fxq -- "$path" "$snapshot/backups" || printf 'backup\t%s\tdirectory\t-\t-\n' "$path"
    done < "$snapshot/after-backups"
    while IFS= read -r path; do
      grep -Fxq -- "$path" "$snapshot/after-backups" || printf 'pruned\t%s\tdirectory\t-\t-\n' "$path"
    done < "$snapshot/backups"
    service_after=$(service_state)
    [ "$service_before" = "$service_after" ] || printf 'service\tvpsmon-agent.service\t%s\t%s\n' "$service_before" "$service_after"
    printf 'END\n'
  ) > "$report.tmp"
  mv -- "$report.tmp" "$report"
  chmod 0644 "$report"
  rm -rf -- "$snapshot"
  exit "$result"
}
trap finish 0
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

case "$action" in
  install|upgrade) sh "$stage/$action-agent.sh" "$stage" ;;
  uninstall) sh "$stage/uninstall-agent.sh" --confirm ;;
  stop)
    systemctl disable --now vpsmon-agent.service
    systemctl disable --now vpsmon-nftables-snapshot.timer >/dev/null 2>&1 || true
    ;;
esac
if [ "$activate" = activate ]; then
  systemctl enable --now vpsmon-agent.service
fi
