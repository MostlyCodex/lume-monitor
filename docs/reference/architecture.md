# Architecture

## Design principle

The system models a VPS as a generic host first. Roles such as relay, egress, backup, application server, or future roles are display metadata, not code paths.

```text
Generic host core
├── required host metrics
├── zero or more read-only systemd service checks
└── zero or more outbound communication probes
    ├── ICMP: network-layer RTT and Echo loss
    └── TCP: connect latency and connect failure rate
```

Adding a node must not require source changes, a database schema update, or a pre-allocated slot. A node becomes known after its first authenticated report. The same report synchronizes its display metadata and optional service/probe catalogs.

## Components

### Agent

The Go Agent runs as an unprivileged systemd service on every VPS. The executable and configuration schema are identical for all nodes.

The required core collects:

- CPU, load, memory, Swap, root filesystem and inode usage;
- network byte counters, errors and drops;
- hostname, operating system, kernel, architecture, boot ID and uptime;
- Agent queue, collection errors, send errors, version and start time.

Node facts show the logical CPU count available to the Agent at startup (`runtime.NumCPU`),
total memory from `/proc/meminfo`, and root filesystem capacity from `statfs("/")`.
Capacities use binary units (MiB/GiB). Missing hardware values display as unknown;
CPU count becomes available after the node runs an Agent that reports `cpu_count`.

Optional `services` entries read systemd state. Optional `probes` entries perform bounded outbound ICMP Echo or TCP Connect checks. ICMP uses `pro-bing` in unprivileged datagram-socket mode; TCP uses ordinary Go sockets and sends no application data. The resident Agent retains an empty capability set.

The local spool retains only the latest failed report. Each round retries that report before collecting and sending the next; another failure replaces the pending entry. Intermediate resource and probe history can be lost during an outage. Traffic-cycle totals are persisted locally before HTTP delivery, so failed delivery alone does not interrupt local accounting.

### Worker

The Cloudflare Worker authenticates each report with a per-node HMAC key from `NODE_KEYS`. Node IDs are arbitrary lowercase slugs rather than a fixed enum. It rejects stale timestamps, reused nonces, unknown nodes, oversized requests and invalid schemas.

After authentication, the Worker:

1. inserts or updates node metadata in `node_catalog` only when metadata actually changes;
2. synchronizes only changed, added or removed service/probe catalog rows rather than rewriting the whole catalog on every report;
3. derives `business_routes` from probes whose category is `node-link`;
4. stores current state and history;
5. exposes current state and historical trends to the dashboard and on-demand Telegram queries.

Two pieces of state are deliberately **not** owned by the report path:

- `node_catalog.retired_at` records an operator decision to decommission a node. Reports update `enabled`; retirement is set by `POST /api/v1/admin/nodes/{id}/retire` and cleared by `/restore`. Catalog reads exclude retired nodes and probes or routes whose target is retired, so retirement takes effect before peer configurations are redeployed.
- `settings.dashboard_origin` records the origin the deployment actually answers on, written by an authenticated admin call. The panel login link uses the request origin, the scheduled webhook check uses the recorded value, and `DASHBOARD_BASE_URL` is only the fallback. A fresh deployment therefore never needs a second `wrangler deploy` to learn its own workers.dev hostname, and moving to a custom domain does not require a redeploy either.

### D1

D1 contains no seeded node topology. Catalog tables are data-driven:

- `node_catalog`: identity, display order, role, group, region, alert policy and operator retirement (`retired_at`);
- `service_catalog`: zero or more services per node;
- `probe_catalog`: zero or more ICMP/TCP probes per node;
- `business_routes`: derived node-to-node relationships.

Other tables store the latest report, metric/probe samples, long-term series rollups, operational events, source-IP history and dashboard login tokens. Current raw history uses time-leading `WITHOUT ROWID` tables: one row per node resource report and one compact JSON row per node communication-probe round. This avoids per-probe and secondary-index write amplification and keeps history queries on one storage format. Recent replay nonces and current network rates share the already-updated latest-state row instead of creating another write per report. Scheduled Worker jobs maintain retention and long-term rollups.

### Telegram and dashboard

Telegram updates arrive through a Webhook protected by a secret header. Only the bound owner's private chat is accepted; no group is required. `/panel` creates a single-use short-lived login token. The dashboard exchanges it for an HttpOnly session cookie. The Bot never initiates alerts or daily summaries.

The dashboard renders its fleet cards, service summaries and probe rows from the catalogs. The fleet view contains current node status, CPU/RAM/disk gauges, network-rate/traffic counters and per-target ICMP 24-hour latency/loss cells. TCP probes still participate in health but appear only in node details, where their failures are labelled as connect failures rather than packet loss. Network rates are interval averages derived from the delta between two consecutive Agent byte-counter reports divided by their report-time delta; they are not streaming real-time measurements. Fleet history uses five-minute display buckets to bound a multi-node response. Clicking a card opens a separate node detail view with selectable probe series plus latency, failure-event and traffic history; CPU/RAM/disk utilization stays on fleet cards, while node facts show hardware capacity. Six- and 24-hour details render immediately from the already-loaded fleet history, then replace it with one-minute data in the background and retain that result in a session cache. The client does not prefetch every node. Longer ranges use hourly buckets for 7/30 days and daily buckets for 90 days. Display aggregation does not change the Agent cadence or raw-data retention. The detail charts use a pinned local copy of uPlot; the dashboard never loads chart code from a CDN. It has no fixed node names or node count.

## Frontend

The Vue 3 application is compiled by Vite and served as same-origin static assets by the Worker. Components render typed public snapshots; transport, polling and browser preferences live in composables and services. Pure domain functions derive status and chart data without mutating API responses.

The overview and node detail share one request owner. Hidden pages stop polling; expired sessions abort outstanding requests, and late responses cannot replace the current node. uPlot loads with the detail view and releases its observers and canvas when unmounted. The production build precompiles templates and retains the existing Content Security Policy.

Display settings stay in browser storage, with separate keys for production and the fictional demo. The build includes only public frontend inputs; management state and credentials remain outside the asset tree.

## Extension model

The communication contract supports `icmp` and `tcp`. Optional collectors must remain configuration-driven, default off, preserve the required host report and use the same generic Agent binary.

`worker/database/schema.sql` defines the complete current database. The management tool initializes an empty D1 in one atomic batch, verifies existing definitions and schema identity on subsequent deployments, then deploys the Worker and checks its live version and database binding. Initialization failure rolls back the whole batch; a mismatched nonempty database stops deployment without changing data. Managed rollback requires the same D1 binding and schema identity, refuses forced Secrets changes, and verifies fresh reports plus dashboard reads. Failed verification restores and rechecks the previous deployment unless another deployment has intervened. The `probe_catalog` schema enforces `CHECK (kind IN ('icmp', 'tcp'))`.

Examples:

- add another external ICMP reference target by adding one probe entry;
- add an ICMP node-to-node check with category `node-link` and `target_node_id`;
- add a TCP reachability check by setting `kind`, `target` and `port`;
- add another systemd service by appending a `services` entry;
- remove an unused check from the node config so it stops executing on the next round.

## Deliberate non-goals

- No automatic routing or failover changes.
- No inbound Agent API.
- No remote shell or command execution.
- No packet capture or application-login testing.
- No service restart, firewall mutation or proxy configuration change.

Measurement definitions, aggregation rules and status thresholds are specified in [monitoring-methodology.md](monitoring-methodology.md).
