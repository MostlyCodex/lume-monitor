import { createHmac, randomBytes } from "node:crypto";

const base = process.env.VPSMON_TEST_URL ?? "http://127.0.0.1:8787";
const secrets = {
  "alpha-vps": "a".repeat(32),
  "beta-vps": "b".repeat(32),
  "revoked-vps": "c".repeat(32),
};

// Keep the complete synthetic sequence at or before wall-clock now. History
// assertions aggregate across output buckets, so CI start time cannot create
// future samples or make the result depend on a five-minute boundary.
const reportEpoch = Math.floor(Date.now() / 1000) - 240;

function nodeMetadata(id, name, order, color) {
  return {
    id,
    display_name: name,
    short_mark: name.split(/\s+/).map((part) => part[0]).join("").slice(0, 4).toUpperCase(),
    role: "VPS",
    group: "integration",
    region: "Test Region",
    stale_seconds: 180,
    display_order: order,
    color,
    offline_severity: "P1",
    ip_change_severity: "P2",
  };
}

function report(id = "alpha-vps") {
  const now = reportEpoch;
  const alpha = id === "alpha-vps";
  return {
    schema_version: 2,
    agent_version: "integration-test",
    node_id: id,
    node: nodeMetadata(id, alpha ? "Alpha VPS" : "Beta VPS", alpha ? 10 : 20, alpha ? "green" : "blue"),
    generated_at: now,
    system: {
      hostname: `integration-${id}`,
      os: "Debian test",
      kernel: "6.12-test",
      arch: "amd64",
      boot_id: `integration-${id}-boot-id`,
      uptime_seconds: 1000,
      cpu_percent: 2,
      ...(alpha ? { cpu_count: 4 } : {}),
      load1: 0.1,
      load5: 0.1,
      load15: 0.1,
      memory_total_bytes: 1_000_000_000,
      memory_available_bytes: 900_000_000,
      swap_total_bytes: 0,
      swap_used_bytes: 0,
      root_total_bytes: 10_000_000_000,
      root_free_bytes: 9_000_000_000,
      root_used_percent: 10,
      root_inode_used_percent: 2,
      network_rx_bytes: 100,
      network_tx_bytes: 200,
      network_rx_errors: 0,
      network_tx_errors: 0,
      network_rx_drops: 0,
      network_tx_drops: 0,
    },
    services: alpha
      ? [{ name: "example.service", label: "Example Service", severity: "P1", state: "active" }]
      : [],
    probes: alpha
      ? [
          {
            name: "peer_icmp",
            label: "Alpha → Beta",
            category: "node-link",
            target_node_id: "beta-vps",
            kind: "icmp",
            target: "beta.example",
            warning_ms: 30,
            critical_ms: 50,
            warning_failure_percent: 20,
            critical_failure_percent: 60,
            severity: "P1",
            display_order: 10,
            primary: true,
            success: true,
            complete: true,
            duration_ms: 11.5,
            average_duration_ms: 11.7,
            p95_duration_ms: 12.9,
            min_duration_ms: 10.2,
            max_duration_ms: 13.1,
            range_ms: 2.9,
            jitter_ms: 1.0,
            samples: 5,
            attempted_samples: 5,
            successful_samples: 5,
            sample_failure_percent: 0,
            packet_loss_percent: 0,
            checked_at: now,
          },
          {
            name: "external_icmp",
            label: "External ICMP",
            category: "external",
            kind: "icmp",
            target: "192.0.2.1",
            warning_ms: 100,
            critical_ms: 200,
            warning_failure_percent: 30,
            critical_failure_percent: 60,
            severity: "P2",
            display_order: 30,
            success: true,
            complete: true,
            duration_ms: 20,
            average_duration_ms: 20.5,
            p95_duration_ms: 22.5,
            min_duration_ms: 18,
            max_duration_ms: 23,
            range_ms: 5,
            jitter_ms: 1.8,
            samples: 5,
            attempted_samples: 5,
            successful_samples: 4,
            sample_failure_percent: 20,
            packet_loss_percent: 20,
            checked_at: now,
          },
        ]
      : [],
    counters: [],
    agent: { queue_depth: 0, collect_errors: 0, send_errors: 0, started_at: now - 1000 },
  };
}

function signedRequest(body, nonce = randomBytes(18).toString("base64url"), valid = true, nodeId = "alpha-vps") {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nodeSecret = secrets[nodeId] ?? "x".repeat(32);
  const signature = createHmac("sha256", valid ? nodeSecret : "z".repeat(32))
    .update(`${timestamp}\n${nonce}\n${body}`)
    .digest("hex");
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Vpsmon-Node": nodeId,
      "X-Vpsmon-Timestamp": timestamp,
      "X-Vpsmon-Nonce": nonce,
      "X-Vpsmon-Signature": `sha256=${signature}`,
    },
    body,
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const health = await fetch(`${base}/healthz`);
assert(health.status === 200 && (await health.json()).ok === true, "healthz failed");

const revokedReport = report("revoked-vps");
const revokedBody = JSON.stringify(revokedReport);
const revoked = await fetch(
  `${base}/api/v1/report`,
  signedRequest(revokedBody, randomBytes(18).toString("base64url"), true, "revoked-vps"),
);
assert(revoked.status === 401, `revoked node returned ${revoked.status}: ${await revoked.text()}`);

const alphaReport = report();
const body = JSON.stringify(alphaReport);
const signed = signedRequest(body);
const accepted = await fetch(`${base}/api/v1/report`, signed);
assert(accepted.status === 202, `valid report returned ${accepted.status}: ${await accepted.text()}`);

const replay = await fetch(`${base}/api/v1/report`, signed);
assert(replay.status === 409, `replay returned ${replay.status}`);

const invalid = signedRequest(body, randomBytes(18).toString("base64url"), false);
const rejected = await fetch(`${base}/api/v1/report`, invalid);
assert(rejected.status === 401, `invalid signature returned ${rejected.status}`);

const rateReport = structuredClone(alphaReport);
rateReport.generated_at += 60;
rateReport.system.network_rx_bytes += 6_000;
rateReport.system.network_tx_bytes += 12_000;
rateReport.probes.forEach((probe) => { probe.checked_at += 60; });
const rateBody = JSON.stringify(rateReport);
const rateAccepted = await fetch(`${base}/api/v1/report`, signedRequest(rateBody));
assert(rateAccepted.status === 202, `rate report returned ${rateAccepted.status}`);

const repeatedProbeReport = structuredClone(rateReport);
repeatedProbeReport.probes[0].duration_ms = 98.5;
const repeatedProbeAccepted = await fetch(
  `${base}/api/v1/report`,
  signedRequest(JSON.stringify(repeatedProbeReport)),
);
assert(repeatedProbeAccepted.status === 202, `repeated probe report returned ${repeatedProbeAccepted.status}`);

const legacyReport = structuredClone(rateReport);
legacyReport.schema_version = 1;
legacyReport.role = "legacy";
delete legacyReport.node;
legacyReport.generated_at += 60;
legacyReport.system.network_rx_bytes += 6_000;
legacyReport.system.network_tx_bytes += 12_000;
legacyReport.services = legacyReport.services.map(({ name, state }) => ({ name, state }));
legacyReport.probes = legacyReport.probes.map((probe) => {
  const {
    name,
    kind,
    target,
    success,
    duration_ms,
    min_duration_ms,
    max_duration_ms,
    jitter_ms,
    samples,
    successful_samples,
    remote_ip,
  } = probe;
  return {
    name,
    kind,
    target,
    success,
    duration_ms,
    min_duration_ms,
    max_duration_ms,
    jitter_ms,
    samples,
    successful_samples,
    remote_ip,
    checked_at: legacyReport.generated_at,
  };
});
const legacyAccepted = await fetch(
  `${base}/api/v1/report`,
  signedRequest(JSON.stringify(legacyReport)),
);
assert(legacyAccepted.status === 202, `schema v1 compatibility returned ${legacyAccepted.status}: ${await legacyAccepted.text()}`);

const optionalReport = structuredClone(rateReport);
optionalReport.generated_at += 120;
optionalReport.system.network_rx_bytes += 12_000;
optionalReport.system.network_tx_bytes += 24_000;
optionalReport.probes.forEach((probe) => { probe.checked_at += 120; });
optionalReport.probes.push({
  name: "peer_tcp_443",
  label: "Alpha → Beta · TCP 443",
  category: "node-link",
  target_node_id: "beta-vps",
  kind: "tcp",
  target: "beta.example",
  port: 443,
  warning_ms: 30,
  critical_ms: 50,
  warning_failure_percent: 1,
  critical_failure_percent: 60,
  severity: "P2",
  display_order: 20,
  success: true,
  complete: true,
  duration_ms: 12.4,
  average_duration_ms: 12.4,
  p95_duration_ms: 13.1,
  min_duration_ms: 11.9,
  max_duration_ms: 13.2,
  range_ms: 1.3,
  jitter_ms: 0.5,
  samples: 3,
  attempted_samples: 3,
  successful_samples: 2,
  sample_failure_percent: 100 / 3,
  checked_at: optionalReport.generated_at,
});
optionalReport.counters = [{
  name: "relay_443",
  label: "443 转发规则",
  kind: "nftables-rule",
  unit: "matches",
  display_order: 10,
  complete: true,
  delta: 12,
  interval_seconds: 60,
  rate_per_minute: 12,
  observed_at: optionalReport.generated_at,
}];
const optionalAccepted = await fetch(
  `${base}/api/v1/report`,
  signedRequest(JSON.stringify(optionalReport)),
);
assert(optionalAccepted.status === 202, `optional observers report returned ${optionalAccepted.status}: ${await optionalAccepted.text()}`);

const betaReport = report("beta-vps");
const betaAccepted = await fetch(
  `${base}/api/v1/report`,
  signedRequest(JSON.stringify(betaReport), undefined, true, "beta-vps"),
);
assert(betaAccepted.status === 202, `plain host-only report returned ${betaAccepted.status}`);

const unauthorized = await fetch(`${base}/api/v1/status`);
assert(unauthorized.status === 401, `unauthorized status returned ${unauthorized.status}`);

const adminHeaders = { authorization: "Bearer local-admin-token-with-32-characters" };
const status = await fetch(`${base}/api/v1/status`, { headers: adminHeaders });
const statusBody = await status.json();
assert(status.status === 200 && statusBody.nodes.some((node) => node.node_id === "alpha-vps"), "status omitted Alpha VPS");
assert(statusBody.nodes.some((node) => node.node_id === "beta-vps"), "status omitted Beta VPS");

const dashboardUnauthorized = await fetch(`${base}/api/v1/dashboard/latest`);
assert(dashboardUnauthorized.status === 401, `unauthorized dashboard returned ${dashboardUnauthorized.status}`);

const dashboard = await fetch(`${base}/api/v1/dashboard/latest`, { headers: adminHeaders });
const dashboardBody = await dashboard.json();
assert(dashboard.status === 200 && dashboardBody.nodes.some((node) => node.id === "alpha-vps"), "dashboard omitted Alpha VPS");
assert(dashboardBody.nodes.some((node) => node.id === "beta-vps"), "dashboard omitted Beta VPS");
assert(dashboardBody.summary.total_nodes === 2, "dashboard fleet is not catalog-driven");
assert(dashboardBody.schema_version === 2, "dashboard schema version is incorrect");
assert(dashboardBody.catalog.nodes.length === 2, "node catalog is incomplete");
assert(dashboardBody.catalog.services.length === 1, "service catalog is incomplete");
assert(dashboardBody.catalog.routes.length === 2, "node-link routes were not registered");
assert(!("counters" in dashboardBody.catalog), "retired counter catalog is still exposed");
const alphaLatest = dashboardBody.nodes.find((node) => node.id === "alpha-vps");
const betaLatest = dashboardBody.nodes.find((node) => node.id === "beta-vps");
assert(alphaLatest.metrics.cpu_count === 4, "CPU capacity was lost between report and dashboard");
assert(betaLatest.metrics.cpu_count === null, "missing CPU capacity must remain unknown");
assert(alphaLatest.metrics.memory_total_bytes === 1_000_000_000, "memory capacity is missing");
assert(alphaLatest.metrics.disk_total_bytes === 10_000_000_000, "root filesystem capacity is missing");
assert(alphaLatest.metrics.network_rx_rate_bps === 100, `network RX rate was not derived correctly: ${alphaLatest.metrics.network_rx_rate_bps}`);
assert(alphaLatest.metrics.network_tx_rate_bps === 200, `network TX rate was not derived correctly: ${alphaLatest.metrics.network_tx_rate_bps}`);
assert(alphaLatest.probes.find((probe) => probe.name === "external_icmp")?.packet_loss_percent === 20, "ICMP packet loss was not exposed");
const tcpLatest = alphaLatest.probes.find((probe) => probe.name === "peer_tcp_443");
assert(tcpLatest?.kind === "tcp" && tcpLatest.packet_loss_percent === null, "TCP failure was mislabeled as packet loss");
assert(Math.round(tcpLatest?.sample_failure_percent) === 33, "TCP connect failure rate is missing");
assert(!("counters" in alphaLatest), "retired counters are still exposed in latest reports");
assert(betaLatest.services.length === 0 && betaLatest.probes.length === 0, "host-only node gained unwanted optional checks");

const history = await fetch(`${base}/api/v1/dashboard/history?hours=24`, { headers: adminHeaders });
const historyBody = await history.json();
assert(history.status === 200 && historyBody.metrics.length >= 1, "dashboard history failed");
assert(historyBody.bucket_seconds === 300, `fleet history should use 5-minute buckets: ${historyBody.bucket_seconds}`);
assert(historyBody.routes.length === 2, "generic node-link statistics are missing");
const alphaRoute = historyBody.routes.find((route) => route.key === "alpha-vps--peer_icmp");
assert(alphaRoute?.rounds >= 2 && alphaRoute?.latency_p50_ms === 11.5, "node-link statistics are incorrect");
const alphaHistory = historyBody.probes.find((probe) => probe.node_id === "alpha-vps" && probe.probe_name === "peer_icmp");
assert(alphaHistory?.latency_ms === 11.5, `repeated probe sample was not deduplicated: ${alphaHistory?.latency_ms}`);
const icmpHistoryRows = historyBody.probes.filter(
  (probe) => probe.node_id === "alpha-vps" && probe.probe_name === "external_icmp",
);
assert(
  icmpHistoryRows.length >= 1 && icmpHistoryRows.every((probe) => probe.kind === "icmp" && probe.packet_loss_percent === 20),
  "ICMP history semantics are incorrect",
);
const icmpAttemptedSamples = icmpHistoryRows.reduce((sum, probe) => sum + Number(probe.attempted_samples ?? 0), 0);
const icmpSuccessfulSamples = icmpHistoryRows.reduce((sum, probe) => sum + Number(probe.successful_samples ?? 0), 0);
assert(
  icmpAttemptedSamples === 20 && icmpSuccessfulSamples === 16,
  `fleet history did not preserve exact sample counts for weighted loss: ${JSON.stringify(icmpHistoryRows)}`,
);

const detail = await fetch(`${base}/api/v1/dashboard/history?hours=24&node=alpha-vps`, { headers: adminHeaders });
const detailBody = await detail.json();
assert(detail.status === 200 && detailBody.selected_node === "alpha-vps", "node detail history failed");
assert(detailBody.bucket_seconds === 60, `node detail history should use 1-minute buckets: ${detailBody.bucket_seconds}`);
assert(detailBody.metrics.every((row) => row.node_id === "alpha-vps"), "node detail leaked another node into metric rows");
assert(detailBody.probe_summaries.some((probe) => probe.probe_name === "peer_icmp"), "node probe summary is missing");
const tcpSummary = detailBody.probe_summaries.find((probe) => probe.probe_name === "peer_tcp_443");
assert(tcpSummary?.packet_loss_percent === null && Math.round(tcpSummary?.sample_failure_percent) === 33, "TCP detail semantics are incorrect");
assert(!("counters" in detailBody), "retired counter history is still exposed");
assert(detailBody.routes.length === 0, "node detail performed unused fleet route aggregation");

for (const hours of [720, 2160]) {
  const ranged = await fetch(`${base}/api/v1/dashboard/history?hours=${hours}`, { headers: adminHeaders });
  const rangedBody = await ranged.json();
  assert(ranged.status === 200 && rangedBody.hours === hours, `${hours}-hour dashboard range failed`);
}

const rebuildUnauthorized = await fetch(`${base}/api/v1/admin/rebuild-observability?offset_days=0`, { method: "POST" });
assert(rebuildUnauthorized.status === 401, "observability rebuild accepted an unauthenticated request");
for (const offsetDays of [0, 1]) {
  const rebuild = await fetch(`${base}/api/v1/admin/rebuild-observability?offset_days=${offsetDays}`, {
    method: "POST",
    headers: adminHeaders,
  });
  assert(rebuild.status === 200 && (await rebuild.json()).ok === true, `observability rebuild failed for day offset ${offsetDays}`);
}

const dashboardPage = await fetch(`${base}/dashboard/`);
assert(dashboardPage.status === 200 && (dashboardPage.headers.get("content-type") ?? "").includes("text/html"), "dashboard asset failed");
const dashboardHtml = await dashboardPage.text();
assert(dashboardHtml.includes("Lume") && dashboardHtml.includes('<div id="app"></div>'), "dashboard mount is missing");
// Vue renders the interface in the browser. Verify the Worker serves the compiled entry assets.
const frontendAssets = [...dashboardHtml.matchAll(/(?:src|href)="(\.\/assets\/[^"<>]+)"/g)].map(match => match[1]);
assert(frontendAssets.some(path => path.endsWith(".js")) && frontendAssets.some(path => path.endsWith(".css")), "compiled frontend entries are missing");
for (const asset of frontendAssets) {
  const response = await fetch(new URL(asset, dashboardPage.url));
  const expectedType = asset.endsWith(".css") ? "text/css" : "javascript";
  assert(response.ok && (response.headers.get("content-type") ?? "").includes(expectedType), "compiled frontend asset is not served correctly");
  assert((await response.text()).length > 0, "compiled frontend asset is empty");
}

const logout = await fetch(`${base}/auth/logout`, { method: "POST" });
assert(logout.status === 204 && (logout.headers.get("set-cookie") ?? "").includes("Max-Age=0"), "dashboard logout failed");

const canary = await fetch(`${base}/api/v1/canary?probe_id=test&nonce=abcdefgh12345678`);
assert(canary.status === 200 && (await canary.json()).nonce === "abcdefgh12345678", "canary failed");

const hostOnlyAlpha = report();
hostOnlyAlpha.generated_at += 240;
hostOnlyAlpha.services = [];
hostOnlyAlpha.probes = [];
hostOnlyAlpha.counters = [];
const hostOnlyAccepted = await fetch(
  `${base}/api/v1/report`,
  signedRequest(JSON.stringify(hostOnlyAlpha)),
);
assert(hostOnlyAccepted.status === 202, "removing optional checks rejected the base host report");
const hostOnlyDashboard = await fetch(`${base}/api/v1/dashboard/latest`, { headers: adminHeaders });
const hostOnlyDashboardBody = await hostOnlyDashboard.json();
const hostOnlyAlphaLatest = hostOnlyDashboardBody.nodes.find((node) => node.id === "alpha-vps");
assert(hostOnlyAlphaLatest.services.length === 0 && hostOnlyAlphaLatest.probes.length === 0, "removed optional checks remained on the node");
assert(hostOnlyDashboardBody.catalog.services.length === 0 && hostOnlyDashboardBody.catalog.routes.length === 0, "removed optional catalogs remained enabled");
assert(hostOnlyDashboardBody.mode === "passive" && hostOnlyDashboardBody.alerts.length === 0, "passive dashboard exposed alert state");
const hostOnlyHistory = await fetch(`${base}/api/v1/dashboard/history?hours=24`, { headers: adminHeaders });
const hostOnlyHistoryBody = await hostOnlyHistory.json();
assert(
  !hostOnlyHistoryBody.probes.some((probe) => probe.node_id === "alpha-vps"),
  "disabled probes remained in fleet history",
);
const hostOnlyDetail = await fetch(`${base}/api/v1/dashboard/history?hours=24&node=alpha-vps`, { headers: adminHeaders });
const hostOnlyDetailBody = await hostOnlyDetail.json();
assert(hostOnlyDetailBody.probes.length === 0, "disabled probes remained in node detail history");
assert(hostOnlyDetailBody.probe_summaries.length === 0, "disabled probes remained in node detail summaries");
assert(!("counters" in hostOnlyDetailBody), "retired counters remained in node detail history");

// Retirement. The regression this guards: Beta is decommissioned while Alpha
// still reports a node-link probe toward it. Before `retired_at` existed,
// Alpha's next report re-enabled both the probe row and the route row, so the
// dead link reappeared on the dashboard within one report interval.
const relinkedAlpha = report();
relinkedAlpha.generated_at += 300;
relinkedAlpha.probes.forEach((probe) => { probe.checked_at = relinkedAlpha.generated_at; });
const relinked = await fetch(`${base}/api/v1/report`, signedRequest(JSON.stringify(relinkedAlpha)));
assert(relinked.status === 202, `re-linked alpha report returned ${relinked.status}`);

const retireUnauthorized = await fetch(`${base}/api/v1/admin/nodes/beta-vps/retire`, { method: "POST" });
assert(retireUnauthorized.status === 401, "retire accepted an unauthenticated request");

const retireUnknown = await fetch(`${base}/api/v1/admin/nodes/no-such-node/retire`, {
  method: "POST",
  headers: adminHeaders,
});
assert(retireUnknown.status === 404, `retiring an unknown node returned ${retireUnknown.status}`);

const retired = await fetch(`${base}/api/v1/admin/nodes/beta-vps/retire`, {
  method: "POST",
  headers: adminHeaders,
});
const retiredBody = await retired.json();
assert(
  retired.status === 200 && retiredBody.retired === true && retiredBody.already_retired === false,
  `retiring beta failed: ${JSON.stringify(retiredBody)}`,
);

// Alpha has not been reconfigured yet and keeps reporting the link.
const staleLinkAlpha = report();
staleLinkAlpha.generated_at += 360;
staleLinkAlpha.probes.forEach((probe) => { probe.checked_at = staleLinkAlpha.generated_at; });
const staleLinkAccepted = await fetch(`${base}/api/v1/report`, signedRequest(JSON.stringify(staleLinkAlpha)));
assert(staleLinkAccepted.status === 202, `report from a peer of a retired node returned ${staleLinkAccepted.status}`);

const afterRetire = await fetch(`${base}/api/v1/dashboard/latest`, { headers: adminHeaders });
const afterRetireBody = await afterRetire.json();
assert(
  !afterRetireBody.nodes.some((node) => node.id === "beta-vps"),
  "retired node reappeared on the dashboard",
);
assert(afterRetireBody.summary.total_nodes === 1, "retired node still counted in the fleet summary");
assert(
  !afterRetireBody.catalog.routes.some((route) => route.target_node_id === "beta-vps"),
  "a peer report re-enabled the route toward a retired node",
);
assert(
  !afterRetireBody.catalog.probes.some((probe) => probe.target_node_id === "beta-vps"),
  "a peer report re-enabled the probe toward a retired node",
);
const alphaAfterRetire = afterRetireBody.nodes.find((node) => node.id === "alpha-vps");
assert(
  !alphaAfterRetire.probes.some((probe) => probe.name === "peer_icmp"),
  "the peer card still shows a link to a retired node",
);

const afterRetireHistory = await fetch(`${base}/api/v1/dashboard/history?hours=24`, { headers: adminHeaders });
const afterRetireHistoryBody = await afterRetireHistory.json();
assert(
  !afterRetireHistoryBody.routes.some((route) => route.key === "alpha-vps--peer_icmp"),
  "retired link still aggregated in fleet history",
);

const adminNodes = await fetch(`${base}/api/v1/admin/nodes`, { headers: adminHeaders });
const adminNodesBody = await adminNodes.json();
const betaAdmin = adminNodesBody.nodes.find((node) => node.node_id === "beta-vps");
assert(
  adminNodes.status === 200 && betaAdmin?.retired === true && typeof betaAdmin.retired_at === "number",
  `admin node listing did not report retirement: ${JSON.stringify(adminNodesBody)}`,
);
assert(
  adminNodesBody.nodes.find((node) => node.node_id === "alpha-vps")?.retired === false,
  "an unrelated node was marked retired",
);

// Retiring twice is a no-op rather than an error, so the tool can be re-run.
const retiredAgain = await fetch(`${base}/api/v1/admin/nodes/beta-vps/retire`, {
  method: "POST",
  headers: adminHeaders,
});
const retiredAgainBody = await retiredAgain.json();
assert(
  retiredAgain.status === 200 && retiredAgainBody.already_retired === true &&
    retiredAgainBody.retired_at === retiredBody.retired_at,
  "repeating a retire changed the recorded retirement time",
);

const restored = await fetch(`${base}/api/v1/admin/nodes/beta-vps/restore`, {
  method: "POST",
  headers: adminHeaders,
});
assert(restored.status === 200 && (await restored.json()).retired === false, "restoring beta failed");
const restoredBeta = report("beta-vps");
restoredBeta.generated_at += 300;
const restoredAccepted = await fetch(
  `${base}/api/v1/report`,
  signedRequest(JSON.stringify(restoredBeta), undefined, true, "beta-vps"),
);
assert(restoredAccepted.status === 202, `report after restore returned ${restoredAccepted.status}`);
const afterRestore = await fetch(`${base}/api/v1/dashboard/latest`, { headers: adminHeaders });
const afterRestoreBody = await afterRestore.json();
assert(
  afterRestoreBody.nodes.some((node) => node.id === "beta-vps"),
  "restored node did not come back on the dashboard",
);

// Origin discovery replaces the second deploy a fresh setup used to need.
const originUnauthorized = await fetch(`${base}/api/v1/admin/dashboard-origin`, { method: "POST" });
assert(originUnauthorized.status === 401, "origin recording accepted an unauthenticated request");
const originRecorded = await fetch(`${base}/api/v1/admin/dashboard-origin`, {
  method: "POST",
  headers: adminHeaders,
});
const originRecordedBody = await originRecorded.json();
assert(
  originRecorded.status === 200 && originRecordedBody.dashboard_origin === new URL(base).origin,
  `origin recording returned ${JSON.stringify(originRecordedBody)}`,
);
const originRead = await fetch(`${base}/api/v1/admin/dashboard-origin`, { headers: adminHeaders });
assert(
  originRead.status === 200 && (await originRead.json()).dashboard_origin === new URL(base).origin,
  "recorded dashboard origin was not read back",
);
const scheduled = await fetch(`${base}/cdn-cgi/local/scheduled?cron=*+*+*+*+*&format=json`);
assert(scheduled.status === 200, `scheduled handler returned ${scheduled.status}`);

const dailyScheduled = await fetch(`${base}/cdn-cgi/local/scheduled?cron=0+1+*+*+*&format=json`);
assert(dailyScheduled.status === 200, `daily scheduled handler returned ${dailyScheduled.status}`);

// An authenticated configuration acknowledgement survives D1 storage and stays
// restricted to the management API. Public metrics retain the selected scope.
const accountingReport = report("alpha-vps");
accountingReport.generated_at = Math.max(Math.floor(Date.now() / 1000), staleLinkAlpha.generated_at + 1);
accountingReport.probes.forEach(probe => {probe.checked_at = accountingReport.generated_at;});
accountingReport.agent.config_fingerprint = "d".repeat(64);
const accountingDate = new Date(accountingReport.generated_at * 1000);
Object.assign(accountingReport.system, {
  network_valid:true, network_interfaces:["eth0"], network_scope:"a".repeat(64),traffic_cycle_enabled:true,
  traffic_cycle:{reset_day:1,time_zone:"UTC",period_start:Date.UTC(accountingDate.getUTCFullYear(),accountingDate.getUTCMonth(),1)/1000,period_end:Date.UTC(accountingDate.getUTCFullYear(),accountingDate.getUTCMonth()+1,1)/1000,observed_since:accountingReport.generated_at,rx_bytes:123,tx_bytes:456,partial:true},
});
const accountingAccepted = await fetch(`${base}/api/v1/report`,signedRequest(JSON.stringify(accountingReport)));
assert(accountingAccepted.status === 202,`accounting report returned ${accountingAccepted.status}: ${await accountingAccepted.text()}`);
const configNodes = await (await fetch(`${base}/api/v1/admin/nodes`,{headers:adminHeaders})).json();
const configNode = configNodes.nodes.find(node=>node.node_id === "alpha-vps");
assert(configNodes.capabilities.config_fingerprint === 1,"configuration capability missing");
assert(configNode.config_fingerprint === accountingReport.agent.config_fingerprint,"actual configuration fingerprint was lost");
assert(configNode.generated_at === accountingReport.generated_at,"configuration acknowledgement used receipt time instead of sample time");
assert(configNode.network_interfaces.join(",") === "eth0" && configNode.network_valid === true,"actual network interfaces missing");
const accountingDashboard = await (await fetch(`${base}/api/v1/dashboard/latest`,{headers:adminHeaders})).json();
const accountingNode = accountingDashboard.nodes.find(node=>node.id === "alpha-vps");
assert(accountingNode.metrics.traffic_cycle.rx_bytes === 123 && accountingNode.metrics.traffic_cycle_enabled,"cycle accounting was lost in the dashboard");
assert(accountingNode.metrics.network_rx_rate_bps === null,"changing network scope fabricated a rate");
assert(!JSON.stringify(accountingDashboard).includes(accountingReport.agent.config_fingerprint),"private config fingerprint leaked into the dashboard");

console.log("integration_ok=true");
