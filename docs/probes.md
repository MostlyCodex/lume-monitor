# Optional checks

`services` and `probes` are optional layers on top of required host metrics. Empty arrays leave a fully valid pure-host monitoring node.

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
