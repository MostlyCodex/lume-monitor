#!/usr/bin/env python3
"""Create a vpsmon Agent config with explicitly named probes removed.

The source file is never modified. The destination must not already exist so the
caller can validate it before replacing the live configuration.
"""

from __future__ import annotations

import argparse
import json
import os
import stat
from pathlib import Path


MAX_CONFIG_BYTES = 128 * 1024


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path, help="existing Agent config")
    parser.add_argument("--output", type=Path, help="new config path")
    parser.add_argument(
        "--remove",
        action="append",
        default=[],
        metavar="PROBE_NAME",
        help="exact probe name to remove; repeat for multiple probes",
    )
    parser.add_argument(
        "--list-names",
        action="store_true",
        help="only print configured probe names; do not create an output file",
    )
    return parser.parse_args()


def load_config(path: Path) -> dict:
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
        raise SystemExit("input must be a regular, non-symlink file")
    if info.st_size > MAX_CONFIG_BYTES:
        raise SystemExit("input config is unexpectedly large")
    with path.open("r", encoding="utf-8") as handle:
        document = json.load(handle)
    probes = document.get("probes")
    if not isinstance(probes, list):
        raise SystemExit("config field 'probes' must be a list")
    names = [probe.get("name") for probe in probes]
    if any(not isinstance(name, str) or not name for name in names):
        raise SystemExit("every probe must have a non-empty string name")
    duplicates = sorted({name for name in names if names.count(name) > 1})
    if duplicates:
        raise SystemExit("duplicate probe names: " + ",".join(duplicates))
    return document


def write_new_config(path: Path, document: dict) -> None:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(path, flags, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        json.dump(document, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())


def main() -> None:
    args = parse_args()
    document = load_config(args.input)
    probes = document["probes"]
    names = [probe["name"] for probe in probes]

    if args.list_names:
        if args.output or args.remove:
            raise SystemExit("--list-names cannot be combined with --output or --remove")
        print("probes=" + ",".join(names))
        return

    if not args.output or not args.remove:
        raise SystemExit("--output and at least one --remove are required")
    if len(set(args.remove)) != len(args.remove):
        raise SystemExit("a probe was requested more than once")
    missing = sorted(set(args.remove) - set(names))
    if missing:
        raise SystemExit("requested probes not present: " + ",".join(missing))

    remove = set(args.remove)
    remaining = [probe for probe in probes if probe["name"] not in remove]
    if not remaining:
        raise SystemExit("refusing to remove every probe")
    document["probes"] = remaining
    write_new_config(args.output, document)
    print("removed=" + ",".join(args.remove))
    print("remaining=" + ",".join(probe["name"] for probe in remaining))


if __name__ == "__main__":
    main()
