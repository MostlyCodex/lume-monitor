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

function nodeMetadata(id, name, order) {
  return {
    id,
    display_name: name,
    role: "VPS",
    region: "Test Region",
    stale_seconds: 180,
    display_order: order,
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
    node: nodeMetadata(id, alpha ? "Alpha VPS" : "Beta VPS", alpha ? 10 : 20),
    generated_at: now,
    system: {
      hostname: `integration-${id}`,
      os: "Debian test",
      kernel: "6.12-test",
      boot_id: `integration-${id}-boot-id`,
      uptime_seconds: 1000,
      cpu_percent: 2,
      ...(alpha ? { cpu_count: 4 } : {}),
      memory_total_bytes: 1_000_000_000,
      memory_available_bytes: 900_000_000,
      root_total_bytes: 10_000_000_000,
      root_used_percent: 10,
      network_rx_bytes: 100,
      network_tx_bytes: 200,
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
            warning_ms: 30,
            critical_ms: 50,
            warning_failure_percent: 20,
            critical_failure_percent: 60,
            severity: "P1",
            display_order: 10,
            success: true,
            complete: true,
            duration_ms: 11.5,
            samples: 5,
            attempted_samples: 5,
            successful_samples: 5,
            checked_at: now,
          },
          {
            name: "external_icmp",
            label: "External ICMP",
            category: "external",
            kind: "icmp",
            warning_ms: 100,
            critical_ms: 200,
            warning_failure_percent: 30,
            critical_failure_percent: 60,
            severity: "P2",
            display_order: 30,
            success: true,
            complete: true,
            duration_ms: 20,
            samples: 5,
            attempted_samples: 5,
            successful_samples: 4,
            checked_at: now,
          },
        ]
      : [],
    agent: { started_at: now - 1000 },
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

const nextReport = structuredClone(rateReport);
nextReport.generated_at += 60;
nextReport.system.network_rx_bytes += 6_000;
nextReport.system.network_tx_bytes += 12_000;
nextReport.probes.forEach(probe => { probe.checked_at += 60; });
const nextAccepted = await fetch(`${base}/api/v1/report`, signedRequest(JSON.stringify(nextReport)));
assert(nextAccepted.status === 202, "the next sample was not accepted");
const unsupportedReport = { ...nextReport, schema_version: 1 };
const unsupported = await fetch(`${base}/api/v1/report`, signedRequest(JSON.stringify(unsupportedReport)));
assert(unsupported.status === 422, "unsupported report schema must be rejected");

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
  warning_ms: 30,
  critical_ms: 50,
  severity: "P2",
  display_order: 20,
  success: true,
  complete: true,
  duration_ms: 12.4,
  samples: 3,
  attempted_samples: 3,
  successful_samples: 2,
  checked_at: optionalReport.generated_at,
});
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

const adminHeaders = { authorization: "Bearer local-admin-token-with-32-characters" };
for (const removed of ["/api/v1/status", "/api/v1/canary?probe_id=test&nonce=abcdefgh12345678", "/api/v1/admin/telegram-diagnostics"]) {
  const response = await fetch(`${base}${removed}`, { headers: adminHeaders });
  assert(response.status === 404, `removed endpoint ${removed} returned ${response.status}`);
}

const dashboardUnauthorized = await fetch(`${base}/api/v1/dashboard/latest`);
assert(dashboardUnauthorized.status === 401, `unauthorized dashboard returned ${dashboardUnauthorized.status}`);

const dashboard = await fetch(`${base}/api/v1/dashboard/latest`, { headers: adminHeaders });
const dashboardBody = await dashboard.json();
assert(dashboard.status === 200 && dashboardBody.nodes.some((node) => node.id === "alpha-vps"), "dashboard omitted Alpha VPS");
assert(dashboardBody.nodes.some((node) => node.id === "beta-vps"), "dashboard omitted Beta VPS");
assert(dashboardBody.schema_version === 2, "dashboard schema version is incorrect");
assert(dashboardBody.catalog.nodes.length === 2, "node catalog is incomplete");
// The dashboard response carries only what the page displays.
assert(
  JSON.stringify(Object.keys(dashboardBody).sort()) === JSON.stringify(["catalog", "nodes", "schema_version", "server_time"]) &&
    JSON.stringify(Object.keys(dashboardBody.catalog).sort()) === JSON.stringify(["known_node_ids", "nodes"]),
  `dashboard exposes undisplayed data: ${Object.keys(dashboardBody)} / ${Object.keys(dashboardBody.catalog)}`,
);
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
assert(tcpLatest?.kind === "tcp" && tcpLatest.success === true && tcpLatest.packet_loss_percent === null, "TCP probes must only report latency and reachability");
assert(tcpLatest.warning_failure_percent === null && !("sample_failure_percent" in tcpLatest), "TCP failure rates are still exposed");
assert(
  JSON.stringify(Object.keys(alphaLatest).sort()) ===
    JSON.stringify(["country", "id", "label", "metrics", "online", "order", "probes", "received_at", "region", "role", "services", "system"]),
  `latest node exposes undisplayed fields: ${Object.keys(alphaLatest)}`,
);
assert(betaLatest.services.length === 0 && betaLatest.probes.length === 0, "host-only node gained unwanted optional checks");

const history = await fetch(`${base}/api/v1/dashboard/history?hours=24`, { headers: adminHeaders });
const historyBody = await history.json();
assert(history.status === 200 && historyBody.metrics.length >= 1, "dashboard history failed");
assert(
  JSON.stringify(Object.keys(historyBody).sort()) ===
    JSON.stringify(["annotations", "hours", "metrics", "probes", "schema_version", "selected_node", "server_time"]),
  `history exposes undisplayed data: ${Object.keys(historyBody)}`,
);
assert(historyBody.metrics.every((row) => Object.keys(row).length === 4), "metric history carries undisplayed series");
const alphaHistory = historyBody.probes.find((probe) => probe.node_id === "alpha-vps" && probe.probe_name === "peer_icmp");
assert(alphaHistory?.latency_ms === 11.5, `repeated probe sample was not deduplicated: ${alphaHistory?.latency_ms}`);
const icmpHistoryRows = historyBody.probes.filter(
  (probe) => probe.node_id === "alpha-vps" && probe.probe_name === "external_icmp",
);
assert(
  icmpHistoryRows.length >= 1 && icmpHistoryRows.every((probe) => probe.packet_loss_percent === 20),
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
assert(detailBody.metrics.every((row) => row.node_id === "alpha-vps"), "node detail leaked another node into metric rows");
const detailTimes = [...new Set(detailBody.metrics.map((row) => row.timestamp))];
assert(detailTimes.length >= 2 && detailTimes.every((time) => time % 60 === 0), "node detail history should use 1-minute buckets");
const tcpHistory = detailBody.probes.filter((probe) => probe.probe_name === "peer_tcp_443");
assert(tcpHistory.length >= 1 && tcpHistory.every((probe) => probe.packet_loss_percent === null), "TCP history must not carry loss");

for (const hours of [720, 2160]) {
  const ranged = await fetch(`${base}/api/v1/dashboard/history?hours=${hours}`, { headers: adminHeaders });
  const rangedBody = await ranged.json();
  assert(ranged.status === 200 && rangedBody.hours === hours, `${hours}-hour dashboard range failed`);
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
  const assetTypes = { ".css": "text/css", ".js": "javascript", ".svg": "image/svg+xml" };
  const expectedType = assetTypes[asset.slice(asset.lastIndexOf("."))];
  assert(expectedType, `unrecognized frontend asset type: ${asset}`);
  assert(response.ok && (response.headers.get("content-type") ?? "").includes(expectedType), `frontend asset is not served correctly: ${asset}`);
  assert((await response.text()).length > 0, "compiled frontend asset is empty");
}

const logout = await fetch(`${base}/auth/logout`, { method: "POST" });
assert(logout.status === 204 && (logout.headers.get("set-cookie") ?? "").includes("Max-Age=0"), "dashboard logout failed");

const hostOnlyAlpha = report();
hostOnlyAlpha.generated_at += 240;
hostOnlyAlpha.services = [];
hostOnlyAlpha.probes = [];
const hostOnlyAccepted = await fetch(
  `${base}/api/v1/report`,
  signedRequest(JSON.stringify(hostOnlyAlpha)),
);
assert(hostOnlyAccepted.status === 202, "removing optional checks rejected the base host report");
const hostOnlyDashboard = await fetch(`${base}/api/v1/dashboard/latest`, { headers: adminHeaders });
const hostOnlyDashboardBody = await hostOnlyDashboard.json();
const hostOnlyAlphaLatest = hostOnlyDashboardBody.nodes.find((node) => node.id === "alpha-vps");
assert(hostOnlyAlphaLatest.services.length === 0 && hostOnlyAlphaLatest.probes.length === 0, "removed optional checks remained on the node");
const hostOnlyHistory = await fetch(`${base}/api/v1/dashboard/history?hours=24`, { headers: adminHeaders });
const hostOnlyHistoryBody = await hostOnlyHistory.json();
assert(
  !hostOnlyHistoryBody.probes.some((probe) => probe.node_id === "alpha-vps"),
  "disabled probes remained in fleet history",
);
const hostOnlyDetail = await fetch(`${base}/api/v1/dashboard/history?hours=24&node=alpha-vps`, { headers: adminHeaders });
const hostOnlyDetailBody = await hostOnlyDetail.json();
assert(hostOnlyDetailBody.probes.length === 0, "disabled probes remained in node detail history");

// Keep a normal node-link report for the following deletion integration.
const relinkedAlpha = report();
relinkedAlpha.generated_at += 300;
relinkedAlpha.probes.forEach((probe) => { probe.checked_at = relinkedAlpha.generated_at; });
const relinked = await fetch(`${base}/api/v1/report`, signedRequest(JSON.stringify(relinkedAlpha)));
assert(relinked.status === 202, `re-linked alpha report returned ${relinked.status}`);

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
accountingReport.generated_at = Math.max(Math.floor(Date.now() / 1000), relinkedAlpha.generated_at + 1);
accountingReport.probes.forEach(probe => {probe.checked_at = accountingReport.generated_at;});
accountingReport.agent.config_fingerprint = "d".repeat(64);
Object.assign(accountingReport.system, {
  network_valid:true, network_interfaces:["eth0"], network_scope:"a".repeat(64), traffic_cycle:{rx_bytes:123,tx_bytes:456},
});
const accountingAccepted = await fetch(`${base}/api/v1/report`,signedRequest(JSON.stringify(accountingReport)));
assert(accountingAccepted.status === 202,`accounting report returned ${accountingAccepted.status}: ${await accountingAccepted.text()}`);
const configNodes = await (await fetch(`${base}/api/v1/admin/nodes`,{headers:adminHeaders})).json();
const configNode = configNodes.nodes.find(node=>node.node_id === "alpha-vps");
assert(configNodes.capabilities.config_fingerprint === 1,"configuration capability missing");
assert(configNodes.capabilities.node_metadata === 2,"node metadata capability missing");
assert(configNode.config_fingerprint === accountingReport.agent.config_fingerprint,"actual configuration fingerprint was lost");
assert(configNode.generated_at === accountingReport.generated_at,"configuration acknowledgement used receipt time instead of sample time");
assert(configNode.network_interfaces.join(",") === "eth0" && configNode.network_valid === true,"actual network interfaces missing");
const accountingDashboard = await (await fetch(`${base}/api/v1/dashboard/latest`,{headers:adminHeaders})).json();
const accountingNode = accountingDashboard.nodes.find(node=>node.id === "alpha-vps");
assert(JSON.stringify(accountingNode.metrics.traffic_cycle) === JSON.stringify({rx_bytes:123,tx_bytes:456}) && !("network_rx_bytes" in accountingNode.metrics),"cycle accounting was lost in the dashboard");
assert(accountingNode.metrics.network_rx_rate_bps === null,"changing network scope fabricated a rate");
assert(!JSON.stringify(accountingDashboard).includes(accountingReport.agent.config_fingerprint),"private config fingerprint leaked into the dashboard");

console.log("integration_ok=true");
