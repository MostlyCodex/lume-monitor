# Architecture

## Design principle

The system models a VPS as a generic host first. Roles such as relay, egress, backup, application server, or future roles are display metadata, not code paths.

```text
Generic host core
├── required host metrics
├── zero or more read-only systemd service checks
└── zero or more outbound communication probes
    ├── node-link: this VPS → another registered VPS
    └── external: this VPS → an external service endpoint
```

Adding a node must not require source changes, a database migration, or a pre-allocated slot. A node becomes known after its first authenticated report. The same report synchronizes its display metadata and optional service/probe catalogs.

## Components

### Agent

The Go Agent runs as an unprivileged systemd service on every VPS. The executable and configuration schema are identical for all nodes.

The required core collects:

- CPU, load, memory, Swap, root filesystem and inode usage;
- network byte counters, errors and drops;
- hostname, operating system, kernel, architecture, boot ID and uptime;
- Agent queue, collection errors, send errors, version and start time.

Optional `services` entries read systemd state. Optional `probes` entries perform bounded outbound ICMP, TCP or TLS checks. ICMP uses `pro-bing` in unprivileged datagram-socket mode; the Agent retains an empty capability set. Failed reports are kept in a one-entry local spool and retried.

### Worker

The Cloudflare Worker authenticates each report with a per-node HMAC key from `NODE_KEYS`. Node IDs are arbitrary lowercase slugs rather than a fixed enum. It rejects stale timestamps, reused nonces, unknown nodes, oversized requests and invalid schemas.

After authentication, the Worker:

1. inserts or updates node metadata in `node_catalog` only when metadata actually changes;
2. synchronizes only changed, added or removed service/probe catalog rows rather than rewriting the whole catalog on every report;
3. derives `business_routes` from probes whose category is `node-link`;
4. stores current state and history;
5. exposes current state and historical trends to the dashboard and on-demand Telegram queries.

### D1

D1 contains no seeded node topology. Catalog tables are data-driven:

- `node_catalog`: identity, display order, role, group, region and alert policy;
- `service_catalog`: zero or more services per node;
- `probe_catalog`: zero or more probes per node;
- `business_routes`: derived node-to-node relationships.

Other tables store the latest report, metric/probe samples, long-term series rollups, operational events, source-IP history and dashboard login tokens. Current raw history uses time-leading `WITHOUT ROWID` tables: one row per node resource report and one compact JSON row per node probe round. This avoids per-probe and secondary-index write amplification while history queries transparently merge pre-upgrade rows until they expire. Recent replay nonces and current network rates share the already-updated latest-state row instead of creating another write per report. Compatibility tables remain in the schema so an upgrade does not destroy existing data. Legacy alert tables likewise remain for migration compatibility but are not read or written by the runtime. Scheduled Worker jobs maintain retention and long-term rollups.

### Telegram and dashboard

Telegram updates arrive through a Webhook protected by a secret header. Only the bound owner's private chat is accepted; no group is required. `/panel` creates a single-use short-lived login token. The dashboard exchanges it for an HttpOnly session cookie. The Bot never initiates alerts or daily summaries.

The dashboard renders its fleet cards, service summaries and probe rows from the catalogs. The fleet view contains only current node status, resource gauges, network-rate/traffic counters and per-target 24-hour latency/loss cells. Fleet history uses five-minute display buckets to bound a multi-node response. Clicking a card opens a separate node detail view with selectable probe series plus latency, packet-loss, resource and traffic history. Node detail uses one-minute buckets for 6/24 hours, hourly buckets for 7/30 days, and daily buckets for 90 days. Display aggregation does not change the Agent cadence or raw-data retention. The detail charts use a pinned local copy of uPlot; the dashboard never loads chart code from a CDN. It has no fixed node names or node count.

## Extension model

New monitoring capabilities should be added as optional probe kinds or optional collectors. They must not change the required host report or introduce role-specific Agent binaries.

Examples:

- add another external TLS endpoint by adding one probe entry;
- add a node-to-node check with category `node-link` and `target_node_id`;
- add another systemd service by appending a `services` entry;
- introduce a future DNS or HTTP semantic probe by extending the probe implementation and schema while preserving existing configurations.

## Deliberate non-goals

- No automatic routing or failover changes.
- No inbound Agent API.
- No remote shell or command execution.
- No packet capture or application-login testing.
- No service restart, firewall mutation or proxy configuration change.

Measurement definitions, aggregation rules and alert hysteresis are specified in [monitoring-methodology.md](monitoring-methodology.md).
