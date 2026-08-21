#!/usr/bin/env python3
"""Convert a v3 Agent config to the generic v4 schema without exposing secrets."""

import json
import os
import stat
import sys


MAX_BYTES = 64 * 1024
OLD_CONFIG = "/etc/vpsmon/config.json"


def fail(message: str) -> "None":
    raise SystemExit(message)


def load_regular_json(path: str) -> dict:
    info = os.lstat(path)
    if not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode):
        fail(f"unsafe JSON file: {path}")
    if info.st_size > MAX_BYTES:
        fail(f"JSON file is too large: {path}")
    with open(path, "r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        fail(f"JSON root must be an object: {path}")
    return value


def stage_path(path: str) -> str:
    resolved = os.path.realpath(path)
    if not resolved.startswith("/tmp/vpsmon-stage."):
        fail("metadata and output must remain under /tmp/vpsmon-stage.*")
    return resolved


def item_name(value: object, kind: str) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict) and isinstance(value.get("name"), str):
        return value["name"]
    fail(f"invalid {kind} entry in the existing config")


def main() -> None:
    if os.geteuid() != 0:
        fail("upgrade-config-v3.py must run as root")
    if len(sys.argv) != 3:
        fail("usage: upgrade-config-v3.py METADATA_JSON OUTPUT_CONFIG")

    metadata_path = stage_path(sys.argv[1])
    output_path = stage_path(sys.argv[2])
    if os.path.dirname(metadata_path) != os.path.dirname(output_path):
        fail("metadata and output must use the same staging directory")

    old = load_regular_json(OLD_CONFIG)
    metadata = load_regular_json(metadata_path)
    node = metadata.get("node")
    service_meta = metadata.get("services")
    probe_meta = metadata.get("probes")
    if not isinstance(node, dict) or not isinstance(service_meta, dict) or not isinstance(probe_meta, dict):
        fail("upgrade metadata is incomplete")

    old_node = old.get("node") if isinstance(old.get("node"), dict) else {}
    old_node_id = old_node.get("id") or old.get("node_id")
    if old_node_id != node.get("id"):
        fail("existing node ID does not match upgrade metadata")

    old_services = old.get("services", [])
    old_probes = old.get("probes", [])
    if not isinstance(old_services, list) or not isinstance(old_probes, list):
        fail("existing services or probes are invalid")

    services = []
    seen_services = set()
    for entry in old_services:
        name = item_name(entry, "service")
        meta = service_meta.get(name)
        if not isinstance(meta, dict) or name in seen_services:
            fail(f"missing or duplicate service metadata: {name}")
        seen_services.add(name)
        services.append({
            "name": name,
            "label": meta.get("label"),
            "severity": meta.get("severity"),
        })
    if seen_services != set(service_meta):
        fail("service metadata does not exactly match the existing config")

    probes = []
    seen_probes = set()
    for entry in old_probes:
        if not isinstance(entry, dict):
            fail("invalid probe entry in the existing config")
        name = item_name(entry, "probe")
        meta = probe_meta.get(name)
        if not isinstance(meta, dict) or name in seen_probes:
            fail(f"missing or duplicate probe metadata: {name}")
        seen_probes.add(name)
        probe = {
            "name": name,
            "label": meta.get("label"),
            "category": meta.get("category"),
            "kind": entry.get("kind"),
            "target": entry.get("target"),
            "timeout_seconds": entry.get("timeout_seconds", 4),
            "samples": entry.get("samples", 1),
            "warning_ms": meta.get("warning_ms", 0),
            "critical_ms": meta.get("critical_ms", 0),
            "severity": meta.get("severity"),
            "display_order": meta.get("display_order"),
            "primary": meta.get("primary", False),
        }
        if meta.get("target_node_id"):
            probe["target_node_id"] = meta["target_node_id"]
        probes.append(probe)
    if seen_probes != set(probe_meta):
        fail("probe metadata does not exactly match the existing config")

    converted = {
        "node": node,
        "endpoint": old.get("endpoint"),
        "secret": old.get("secret"),
        "report_interval_seconds": old.get("report_interval_seconds", 60),
        "probe_interval_seconds": old.get("probe_interval_seconds", 300),
        "services": services,
        "probes": probes,
        "spool_path": old.get("spool_path", "/var/lib/vpsmon/pending.json"),
    }
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(output_path, flags, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(converted, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
    except Exception:
        try:
            os.unlink(output_path)
        except FileNotFoundError:
            pass
        raise
    print("configuration converted; secret retained only on this VPS")


if __name__ == "__main__":
    main()
