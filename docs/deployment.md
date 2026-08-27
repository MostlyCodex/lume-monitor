# Deployment

For a new installation, start with the interactive, resumable
[`lumectl` quickstart](quickstart.md). It creates the Cloudflare resources,
keeps the complete `NODE_KEYS` mapping in a Git-ignored private state directory,
and can install a checksum-verified release Agent over an SSH alias. The manual
steps below remain the auditable fallback and the reference for existing
deployments.

This guide describes a fresh generic installation. Replace every example value with your own and never commit the resulting secret-bearing files.

For a PowerShell-friendly, end-to-end first installation including Telegram binding and exact add-node steps, start with [getting-started.md](getting-started.md). This document is the concise operator reference for installation, upgrades and rollback.

## 1. Prerequisites

- Cloudflare account with Workers and D1 access.
- Node.js 22 or newer and npm.
- Go 1.26 or newer for Agent builds.
- Linux VPS hosts using systemd.
- Optional Telegram Bot created through BotFather.

## 2. Prepare the Worker

```bash
cd worker
npm ci
npx wrangler login
npx wrangler d1 create lume
cp wrangler.example.jsonc wrangler.jsonc
```

Edit `wrangler.jsonc` and set the returned D1 `database_id`, your Worker URL and optional Telegram Bot username. `worker/wrangler.jsonc` is ignored by Git.

Apply the generic schema:

```bash
npx wrangler d1 migrations apply lume --remote
```

Choose a lowercase node slug for every VPS. Valid IDs match:

```text
[a-z0-9][a-z0-9_-]{0,31}
```

Generate one independent random secret of at least 32 characters per node. `NODE_KEYS` is a JSON object and can contain any valid IDs:

```json
{
  "my-vps-01": "<independent-random-secret>",
  "my-vps-02": "<different-independent-random-secret>"
}
```

Enter secrets interactively so they are not stored in shell history:

```bash
npx wrangler secret put NODE_KEYS
npx wrangler secret put ADMIN_TOKEN
```

Deploy:

```bash
npm run check
npm run deploy
```

## 3. Optional Telegram integration

Set these Worker secrets interactively:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put TELEGRAM_BIND_CODE_HASH
```

- `TELEGRAM_WEBHOOK_SECRET`: at least 32 random characters.
- `TELEGRAM_BIND_CODE_HASH`: lowercase SHA-256 hex digest of a one-time URL-safe binding code containing 16–128 characters.

Configure the Webhook through the authenticated admin endpoint:

```bash
curl -X POST "https://your-worker.example/api/v1/admin/configure-telegram-webhook" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

To authorize private Bot commands, send `/bind <one-time-code>` in the intended private Bot chat. Remove the plaintext binding code afterward. The Bot responds only to this bound private account and does not require a group. Collection continues independently of Telegram commands; no proactive alerts or daily summaries are sent.

## 4. Build the single Agent binary

For a tagged release, the preferred path is to download an explicit version and
verify its published SHA-256 before staging it:

```bash
sh deploy/fetch-release-agent.sh v1.0.1 /tmp/vpsmon-agent
/tmp/vpsmon-agent --version
```

This helper only downloads and verifies a file. It does not install, restart or
modify a VPS. The complete release and provenance process is documented in
[testing-and-releases.md](testing-and-releases.md). To build from source instead:

```bash
cd ../agent
go test ./...
CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X main.version=1.2.0" -o vpsmon-agent ./cmd/vpsmon-agent
```

The same binary is used on every VPS.

`pro-bing` is compiled into the static binary; no ping executable or additional runtime package is required. Before enabling an ICMP probe, verify that the Agent group falls inside the Linux unprivileged ping range:

```bash
id vpsmon
cat /proc/sys/net/ipv4/ping_group_range
```

If the range excludes `vpsmon`, leave ICMP probes disabled or deliberately configure the host's ping group policy after a security review. Do not grant the Agent root, `CAP_NET_RAW`, or an ambient capability.

TCP Connect uses the Go standard library and needs no extra package or capability. Optional nftables counter observation uses the host's existing `nft` executable. Only its timer-triggered snapshot service holds `CAP_NET_ADMIN`; the resident Agent remains unprivileged and no rule is changed.

## 5. Create one node configuration

Copy the only template to a private location outside the repository:

```bash
cp ../deploy/config.example.json /secure/location/my-vps-01.json
```

At minimum, replace:

- `node.id` with a key present in `NODE_KEYS`;
- `node.display_name` and other display metadata;
- `endpoint` with `https://<worker>/api/v1/report`;
- `secret` with that node's matching secret.

Leave all optional arrays empty for pure host monitoring:

```json
"services": [],
"probes": [],
"nftables_counters": []
```

Add service, communication or local-counter checks only when needed. See the [optional-observer manual](probes.md) for composable examples, exact semantics and clean removal.

## 6. Install one Agent

Create a private staging directory on the VPS matching `/tmp/vpsmon-stage.*`. Place these files in it:

- compiled binary named `vpsmon-agent`;
- that node's configuration named `config.json`;
- `deploy/vpsmon-agent.service`;
- `deploy/vpsmon-nftables-snapshot.service`;
- `deploy/vpsmon-nftables-snapshot.timer`;
- `deploy/install-agent.sh`;
- `checksums.sha256` covering the binary, configuration and three units.

Example checksum creation inside the staging directory:

```bash
sha256sum vpsmon-agent config.json vpsmon-agent.service \
  vpsmon-nftables-snapshot.service vpsmon-nftables-snapshot.timer \
  > checksums.sha256
```

Run the installer as root:

```bash
sudo sh install-agent.sh /tmp/vpsmon-stage.<random>
```

The installer refuses to overwrite an existing Agent installation, validates checksums and configuration, compares every configured monitored service before and after, and rolls back only its own files if validation fails. It always starts `vpsmon-agent.service`; the snapshot timer is enabled only when `nftables_counters` is non-empty.

Verify:

```bash
systemctl status vpsmon-agent.service
journalctl -u vpsmon-agent.service --since "10 minutes ago"
```

The first accepted report automatically creates the node, service and probe catalog entries. No Worker source or D1 migration change is required.

## 7. Add another VPS later

1. Add a new ID and a new secret to your securely retained **complete** `NODE_KEYS` JSON mapping, then write the complete mapping back with `wrangler secret put NODE_KEYS`. Cloudflare Secrets cannot be read back; submitting only the new entry revokes every omitted node.
2. Copy `deploy/config.example.json` again and set the new metadata/secret.
3. Reuse the same binary when the CPU architecture matches, then install it with the same unit and installer.
4. Verify `vpsmon-agent.service`, `/status` and the dashboard after the first accepted report.

Do not reuse node IDs or secrets. No code or schema edit is needed.

## 8. Removal

```bash
sudo sh uninstall-agent.sh --confirm
```

The uninstaller removes the monitoring units, optional numeric snapshot, binary and configuration. It retains the service account and report spool for recoverability. It never deletes or changes nftables rules.

## 9. Upgrade an existing Agent

Build and stage the new binary, configuration, three units and checksum file exactly as in section 6, then run:

```bash
sudo sh upgrade-agent.sh /tmp/vpsmon-stage.<random>
```

The upgrade script validates the staged release before stopping the monitor, records a checksummed backup under `/var/lib/vpsmon/upgrade-backup.<UTC timestamp>`, and preserves the prior enabled/running state. It fingerprints every service named by either the old or new configuration and automatically restores only the monitor files if the Agent fails to start or a protected service changes state.

After a successful upgrade it keeps the newest three strictly named upgrade
backups and removes older matching directories. Unrelated files, symlinks and
lookalike names are never selected. Set `VPSMON_KEEP_UPGRADE_BACKUPS` to an
integer from 1 through 20 before invoking the script to change the retention;
cleanup failure is reported as a warning and never turns a successful upgrade
into a rollback.

## 10. Compatible rollout for probe-quality upgrades

Use this order when upgrading an existing installation:

1. apply the new D1 migration;
2. deploy the Worker and verify old Agent reports are still accepted;
3. upgrade one Agent and observe it for several report/probe rounds;
4. upgrade remaining Agents;
5. add ICMP/TCP probes, nftables counters or failure-rate thresholds only after the upgraded Agent is stable.

This keeps database and API consumers ahead of producers. Never copy production Agent configurations or D1 exports into the repository while preparing a release.
