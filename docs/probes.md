# Optional checks

`services` and `probes` are optional layers on top of required host metrics. Empty arrays leave a fully valid pure-host monitoring node.

`/etc/vpsmon/config.json` is the complete execution list. The Agent does not
invent targets or remotely enable checks. Every configured probe runs at
`probe_interval_seconds`, even when a particular UI intentionally omits that
probe kind. Removing the config entry is the only way to stop its network work.

## systemd services

```json
"services": [
  {
    "name": "example.service",
    "label": "Example Service",
    "severity": "P1"
  }
]
```

The Agent only reads the unit state. It never starts, stops, restarts or reloads the service. Configure zero to sixteen entries.

## ICMP node-to-node quality

Configure the probe on the source VPS. `target_node_id` must match the destination node ID used by the Worker and destination Agent.

```json
"probes": [
  {
    "name": "peer_icmp",
    "label": "Source VPS → Destination VPS",
    "category": "node-link",
    "target_node_id": "destination-vps",
    "kind": "icmp",
    "target": "destination.example.net",
    "timeout_seconds": 3,
    "samples": 5,
    "sample_interval_ms": 250,
    "warning_ms": 30,
    "critical_ms": 50,
    "warning_failure_percent": 20,
    "critical_failure_percent": 60,
    "severity": "P1",
    "display_order": 10,
    "primary": true
  }
]
```

The target has no port. This probe measures ICMP RTT and Echo loss. ICMP filtering or rate limiting can look like loss, so pair it with a TCP probe when service reachability matters.

## TCP node-to-node reachability

```json
"probes": [
  {
    "name": "peer_tcp",
    "label": "Source VPS → Destination Service",
    "category": "node-link",
    "target_node_id": "destination-vps",
    "kind": "tcp",
    "target": "destination.example.net:443",
    "timeout_seconds": 4,
    "samples": 5,
    "sample_interval_ms": 250,
    "warning_ms": 30,
    "critical_ms": 50,
    "warning_failure_percent": 20,
    "critical_failure_percent": 60,
    "severity": "P1",
    "display_order": 20
  }
]
```

The Worker derives a dashboard relationship and historical route analysis from authenticated `node-link` metadata. This optional view does not change either node's base monitoring.

## External TLS service

```json
"probes": [
  {
    "name": "external_tls",
    "label": "External Service TLS",
    "category": "external",
    "kind": "tls",
    "target": "service.example.com:443",
    "timeout_seconds": 5,
    "samples": 3,
    "sample_interval_ms": 300,
    "warning_ms": 500,
    "critical_ms": 1000,
    "warning_failure_percent": 34,
    "critical_failure_percent": 67,
    "severity": "P2",
    "display_order": 30
  }
]
```

A TLS probe resolves DNS once per round, connects to the resolved address and completes a TLS handshake. Its duration excludes DNS lookup time. It does **not** prove login state, API authorization, application behavior, account health or content availability.

## Probe fields

| Field | Meaning |
| --- | --- |
| `name` | Stable per-node slug used for history and alert identity |
| `label` | Human-readable dashboard and Telegram label |
| `category` | `node-link`, `external`, or another safe descriptive category |
| `target_node_id` | Required only for `node-link` |
| `kind` | `icmp`, `tcp`, or `tls` |
| `target` | ICMP: host/IP without port; TCP/TLS: `host:port` |
| `timeout_seconds` | Whole-round bound, 1–15 seconds |
| `samples` | 1–10 requested measurements; defaults to 5 for ICMP and 1 otherwise |
| `sample_interval_ms` | Start interval, 100–5000 ms; defaults to 250 ms |
| `warning_ms` / `critical_ms` | Optional p50 latency thresholds; zero disables one |
| `warning_failure_percent` / `critical_failure_percent` | Optional single-round ICMP loss or TCP/TLS connection-failure thresholds used by current state and route analysis |
| `severity` | `P1`, `P2`, or `INFO` state classification retained for report compatibility |
| `display_order` | Stable UI ordering |
| `primary` | Preferred summary probe for the node |

The warning threshold must not exceed its critical threshold when both are enabled. The sample schedule must fit inside the whole-round timeout. Probe targets generate outbound traffic from your VPS; review authorization, provider policy and expected request volume before enabling them.

The per-probe failure thresholds describe the latest measurement round. They intentionally do not color the dashboard's 24-hour packet-loss energy cells: those long-window cells use exact sample-count weighting, fixed 2%/10% levels, and a 60% five-minute severe-loss guard. This separation prevents a threshold such as 20%—appropriate for one lost Echo out of five—from hiding sustained lower loss across an 80-minute cell. See [monitoring-methodology.md](monitoring-methodology.md#首页当前值与-24-小时能量棒) for the formulas and time scopes.

Exact formulas and limitations are in [monitoring-methodology.md](monitoring-methodology.md).

## Removing an unused probe

Do not merely hide an obsolete probe in the dashboard. Generate a separate
candidate config, validate it, back up the live config, and restart only the
monitoring Agent.

1. Copy `deploy/prune-probes.py` to a private staging directory on the VPS, or
   run it on a trusted administration machine that holds a private config copy.
2. Generate a new file. Repeat `--remove` for multiple exact names:

   ```bash
   python3 prune-probes.py \
     --input /etc/vpsmon/config.json \
     --output /tmp/vpsmon-stage.ID/config.next.json \
     --remove OLD_PROBE_NAME
   ```

   The tool refuses symlink input, duplicate/missing names, an existing output
   path, or removal of every probe. It never edits the source file.
3. Preflight the candidate without installing or reporting it:

   ```bash
   sudo /opt/vpsmon/vpsmon-agent \
     --config /tmp/vpsmon-stage.ID/config.next.json \
     --dry-run >/dev/null
   ```

4. Back up the live file with restrictive permissions, install the candidate,
   and restart only `vpsmon-agent.service`. Restore the backup immediately if
   the unit is not active afterward. Do not restart any monitored business
   service.
5. After the next accepted report, verify that the Worker catalog marks the
   removed name `enabled=0` and that the latest report contains only the intended
   probe count.

Disabled catalog rows and retained historical samples are passive data. They do
not cause Agent traffic, Worker polling, or scheduled re-probing. Raw samples
expire under the normal retention job; deleting packed history is neither
required to stop collection nor recommended as part of routine config cleanup.
