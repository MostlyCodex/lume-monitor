# Testing, migration safety and releases

This document defines the repeatable checks behind Lume releases. All
fixtures use reserved example identities and dummy keys. Never replace them
with a production D1 export, real node configuration or account secret.

## Test layers

### Agent

From `agent/`:

```bash
go test ./...
go vet ./...
go test -run '^$' -bench Benchmark -benchmem -count 3 ./...
```

The normal tests cover configuration, signing, spool and ICMP result semantics.
The benchmarks measure representative report serialization, HMAC signing and,
on Linux, one host collection pass.

### Worker unit and presentation tests

From `worker/`:

```bash
npm ci
npm run check
```

This performs TypeScript checking, JavaScript syntax checking and the Vitest
suite. It does not contact Cloudflare or production D1.

### Local Wrangler and D1 integration

From `worker/`:

```bash
npm run test:integration
```

The runner creates isolated temporary local D1 databases and then:

1. loads a sanitized pre-`0006` schema fixture and applies every
   `migrations-v3` production-upgrade migration;
2. verifies that legacy node and latest-state rows survive and obsolete probe
   kinds do not;
3. creates a completely empty database and applies every fresh migration;
4. starts a local Wrangler Worker on an unused loopback port;
5. exercises health, signed reports, invalid signatures, replay rejection,
   legacy-envelope compatibility, catalogs, current state, history, rollups,
   scheduled handlers, dashboard assets and authentication boundaries.

### Real-browser visual contract

From `worker/`, install the pinned Chromium build once and run Playwright:

```bash
npx playwright install chromium
npm run test:browser
```

The browser suite serves deterministic fictional data and renders the actual
dashboard HTML, CSS, JavaScript and uPlot bundle. It checks dark/light glass
materials, charts, color keys, keyboard focus, touch targets, Japanese flag
rendering and horizontal overflow at 1440, 1024, 768 and 390 pixel viewports.
It never opens the production Worker or D1. Screenshots, traces and the HTML
report are ignored locally; CI uploads them for 14 days on every run.

`npm run test:ci` runs the static/unit suite, local D1/HTTP integration suite
and this real-browser suite.
The test Wrangler files contain only obvious dummy values and must remain
separate from the ignored production `wrangler.jsonc` and `.dev.vars` files.

When a schema migration is added, update both the fresh migration chain and the
production-upgrade chain where applicable. Change the historical fixture only
when the documented starting schema changes; never copy production rows into
Git.

## Repeatable Agent performance report

On Linux, from the repository root:

```bash
bash scripts/benchmark-agent.sh
```

Results are written to ignored `benchmark-results/` files:

- `go-bench.txt`: time and allocations for collectors, serialization and HMAC;
- `summary.txt`: Go version, stripped binary size, hash and dry-run peak RSS;
- `process-metrics.txt`: `/usr/bin/time -v` process details.

GitHub CI runs the same script and retains the files as a workflow artifact for
30 days. Hosted-runner measurements are intended for detecting large regressions
between revisions. They are not a fair absolute ranking against another project
unless hardware, kernel, configuration and workload are identical.

## Release process

The release workflow is deliberately tag-only and never deploys an Agent to a
VPS. For a new reviewed version:

1. ensure CI is green on the commit to release;
2. use an immutable semantic-version tag such as `v1.0.1`;
3. push the tag;
4. wait for `.github/workflows/release.yml` to rerun the full Agent and Worker
   checks;
5. verify the resulting GitHub Release assets.

The workflow produces static Linux `amd64` and `arm64` binaries, per-binary Go
build information, `SHA256SUMS`, and GitHub build-provenance attestations. The
version embedded in each Agent is derived directly from the tag; the native
`amd64` artifact is also executed to verify its reported version before upload.
Existing release assets and tags are immutable and must not be replaced or moved
to point at a different commit.

Download an explicit version without installing or restarting anything:

```bash
sh deploy/fetch-release-agent.sh v1.0.1 /tmp/vpsmon-agent
/tmp/vpsmon-agent --version
```

The helper detects `amd64` or `arm64`, requires HTTPS, downloads the checksum
manifest, verifies SHA-256 and refuses to overwrite an existing path. It does
not edit configuration, install a systemd service or update a running Agent.
Continue with the normal staged install/upgrade process after inspection.

If GitHub CLI is available, provenance can also be verified independently:

```bash
gh attestation verify /tmp/vpsmon-agent --repo MostlyCodex/lume-monitor
```

Forks can set `VPSMON_GITHUB_REPOSITORY=owner/repository` when using the fetch
helper. Automatic Agent updates remain intentionally out of scope.
