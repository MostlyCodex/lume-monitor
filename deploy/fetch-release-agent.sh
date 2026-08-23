#!/bin/sh
set -eu

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "usage: fetch-release-agent.sh v1.2.3 [output-path]" >&2
  exit 2
fi

version=$1
output=${2:-./vpsmon-agent}
repository=${VPSMON_GITHUB_REPOSITORY:-MostlyCodex/yuanshan-monitor}

if ! printf '%s' "$version" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$'; then
  echo "version must be an explicit tag such as v1.2.3" >&2
  exit 2
fi
if [ -e "$output" ] || [ -L "$output" ]; then
  echo "refusing to overwrite existing output: $output" >&2
  exit 3
fi
if ! printf '%s' "$repository" | grep -Eq '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'; then
  echo "VPSMON_GITHUB_REPOSITORY must use owner/repository form" >&2
  exit 2
fi

case "$(uname -m)" in
  x86_64|amd64) architecture=amd64 ;;
  aarch64|arm64) architecture=arm64 ;;
  *) echo "unsupported architecture: $(uname -m)" >&2; exit 2 ;;
esac

asset="vpsmon-agent-linux-${architecture}"
base_url="https://github.com/${repository}/releases/download/${version}"
temporary_directory=$(mktemp -d)
trap 'rm -rf -- "$temporary_directory"' EXIT HUP INT TERM

curl --fail --location --silent --show-error --retry 3 \
  --proto '=https' --tlsv1.2 "$base_url/$asset" -o "$temporary_directory/$asset"
curl --fail --location --silent --show-error --retry 3 \
  --proto '=https' --tlsv1.2 "$base_url/SHA256SUMS" -o "$temporary_directory/SHA256SUMS"

expected=$(awk -v asset="$asset" '$2 == asset { print $1 }' "$temporary_directory/SHA256SUMS")
if [ -z "$expected" ]; then
  echo "release checksum does not contain $asset" >&2
  exit 4
fi
actual=$(sha256sum "$temporary_directory/$asset" | cut -d ' ' -f 1)
if [ "$actual" != "$expected" ]; then
  echo "SHA-256 verification failed for $asset" >&2
  exit 4
fi

install -m 0755 "$temporary_directory/$asset" "$output"
echo "downloaded=$output"
echo "version=$version"
echo "sha256=$actual"
