#!/bin/sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
output_directory=${1:-"$repository_root/benchmark-results"}
temporary_directory=$(mktemp -d)
trap 'rm -rf -- "$temporary_directory"' EXIT HUP INT TERM

mkdir -p -- "$output_directory"
output_directory=$(CDPATH= cd -- "$output_directory" && pwd)
cd "$repository_root/agent"

go test -run '^$' -bench 'Benchmark' -benchmem -count 3 ./... | tee "$output_directory/go-bench.txt"

CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X main.version=benchmark" \
  -o "$temporary_directory/vpsmon-agent" ./cmd/vpsmon-agent
cp testdata/benchmark-config.json "$temporary_directory/config.json"
chmod 0600 "$temporary_directory/config.json"

/usr/bin/time -v -o "$output_directory/process-metrics.txt" \
  "$temporary_directory/vpsmon-agent" --dry-run --config "$temporary_directory/config.json" >/dev/null

binary_bytes=$(wc -c < "$temporary_directory/vpsmon-agent" | tr -d ' ')
binary_sha256=$(sha256sum "$temporary_directory/vpsmon-agent" | cut -d ' ' -f 1)
maximum_rss_kib=$(awk -F: '/Maximum resident set size/ {gsub(/^[[:space:]]+/, "", $2); print $2}' \
  "$output_directory/process-metrics.txt")

{
  printf 'go_version=%s\n' "$(go version)"
  printf 'agent_binary_bytes=%s\n' "$binary_bytes"
  printf 'agent_binary_sha256=%s\n' "$binary_sha256"
  printf 'dry_run_maximum_rss_kib=%s\n' "${maximum_rss_kib:-unknown}"
} > "$output_directory/summary.txt"

cat "$output_directory/summary.txt"
