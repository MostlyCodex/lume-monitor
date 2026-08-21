import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.PORT || 4173);
const publicRoot = resolve(fileURLToPath(new URL("../public/", import.meta.url)));
const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
]);

const nodeDefinitions = [
  { id: "transit-la", label: "Transit-Los-Angeles", mark: "LA", role: "线路中转机", region: "Los Angeles", country: "US", service: ["nftables", "nftables"], bases: [151, 158, 181, 8], resources: [18.4, 34.2, 28.5] },
  { id: "transit-eb", label: "Transit-Edge-Bridge", mark: "EB", role: "线路中转机", region: "Los Angeles", country: "US", service: ["nftables", "nftables"], bases: [155, 164, 188, 9], resources: [11.6, 27.8, 41.3] },
  { id: "egress-lv", label: "Egress-Las-Vegas", mark: "LV", role: "住宅出口落地机", region: "Las Vegas", country: "US", service: ["xray", "Xray"], bases: [42], resources: [22.7, 43.6, 67.4] },
  { id: "hybrid-la", label: "Hybrid-LAX-Tri", mark: "LX", role: "线路 + 落地机", region: "Los Angeles", country: "US", service: ["xray", "Xray"], bases: [149, 157, 179], resources: [9.8, 31.4, 23.6] },
  { id: "transit-pro", label: "Transit-Pro", mark: "PR", role: "线路中转机", region: "Los Angeles", country: "US", service: ["nftables", "nftables"], bases: [153, 161, 184, 7], resources: [14.1, 76.8, 35.2] },
  { id: "hybrid-sg", label: "Hybrid-Singapore", mark: "SG", role: "线路 + 落地机", region: "Singapore", country: "SG", service: ["xray", "Xray"], bases: [72, 78, 91], resources: [31.5, 52.7, 87.2] },
];

function probeDefinitions(node) {
  if (node.id === "egress-lv") return [{ name: "public-connectivity", label: "外网连通性", category: "external", base: node.bases[0], order: 1 }];
  const probes = [
    { name: "beijing-ct", label: "北京电信", category: "carrier", base: node.bases[0], order: 1 },
    { name: "beijing-cu", label: "北京联通", category: "carrier", base: node.bases[1], order: 2 },
    { name: "beijing-cm", label: "北京移动", category: "carrier", base: node.bases[2], order: 3 },
  ];
  if (node.bases[3]) probes.push({ name: "node-link", label: `${node.label} → Egress-Las-Vegas`, category: "node-link", base: node.bases[3], order: 4 });
  return probes;
}

function currentProbe(node, probe, index) {
  const elevated = node.id === "hybrid-sg" && probe.name === "beijing-cm";
  return {
    name: probe.name,
    label: probe.label,
    category: probe.category,
    kind: "icmp",
    primary: index === 0,
    order: probe.order,
    warning_ms: probe.base * 1.35,
    critical_ms: probe.base * 1.7,
    warning_failure_percent: 1,
    critical_failure_percent: 5,
    success: true,
    complete: true,
    duration_ms: Math.round((elevated ? probe.base * 1.42 : probe.base + Math.sin(index + 0.8) * 3) * 10) / 10,
    packet_loss_percent: elevated ? 6 : index === 1 && node.id === "transit-la" ? 2 : 0,
    sample_failure_percent: elevated ? 6 : index === 1 && node.id === "transit-la" ? 2 : 0,
    samples: 20,
    attempted_samples: 20,
    successful_samples: elevated ? 19 : 20,
  };
}

function latestData() {
  const now = Math.floor(Date.now() / 1000);
  const nodes = nodeDefinitions.map((definition, nodeIndex) => ({
    ...definition,
    order: nodeIndex + 1,
    online: true,
    age_seconds: 18 + nodeIndex * 5,
    received_at: now - 18 - nodeIndex * 5,
    reported_at: now - 20 - nodeIndex * 5,
    source_ip: nodeIndex % 2 ? "198.51.100.x" : "203.0.113.x",
    source_asn: 64500 + nodeIndex,
    colo: definition.region,
    system: { hostname: definition.id, os: "Debian GNU/Linux 12", kernel: "6.1.0", arch: "x86_64" },
    metrics: {
      cpu_percent: definition.resources[0], memory_used_percent: definition.resources[1], disk_used_percent: definition.resources[2],
      memory_total_bytes: 1024 ** 3 * (1 + (nodeIndex % 3)),
      memory_available_bytes: 1024 ** 3 * (1 + (nodeIndex % 3)) * (1 - definition.resources[1] / 100),
      disk_total_bytes: 1024 ** 3 * (20 + nodeIndex * 5),
      disk_free_bytes: 1024 ** 3 * (20 + nodeIndex * 5) * (1 - definition.resources[2] / 100),
      load1: 0.08 + nodeIndex * 0.03, load5: 0.11 + nodeIndex * 0.02, load15: 0.09 + nodeIndex * 0.025,
      uptime_seconds: 86400 * (18 + nodeIndex * 7) + 3600 * nodeIndex,
      network_rx_rate_bps: 180000 + nodeIndex * 46000, network_tx_rate_bps: 92000 + nodeIndex * 22000,
      network_rx_bytes: 83000000000 + nodeIndex * 17000000000, network_tx_bytes: 42000000000 + nodeIndex * 9000000000,
    },
    services: [{ name: definition.service[0], label: definition.service[1], state: "active" }],
    probes: probeDefinitions(definition).map((probe, index) => currentProbe(definition, probe, index)),
    agent: { version: "1.0.0-preview", queue_depth: 0, collect_errors: 0, send_errors: 0 },
  }));
  return {
    schema_version: 2,
    server_time: now,
    app_version: "preview",
    mode: "live",
    summary: { online_nodes: nodes.length, total_nodes: nodes.length, active_alerts: 0, pending_alerts: 0, p1_alerts: 0 },
    catalog: { nodes: nodeDefinitions.map((node, index) => ({ id: node.id, label: node.label, mark: node.mark, role: node.role, region: node.region, order: index + 1 })), routes: [] },
    nodes,
    alerts: [],
    recent_events: [],
    cadence: { resources_seconds: 60, probes_seconds: 60 },
  };
}

function historyData(hours, selectedNode) {
  const now = Math.floor(Date.now() / 1000);
  const bucket = hours <= 24 ? 300 : hours <= 720 ? 3600 : 86400;
  const steps = Math.min(360, Math.max(12, Math.floor((hours * 3600) / bucket)));
  const selected = selectedNode ? nodeDefinitions.filter((node) => node.id === selectedNode) : nodeDefinitions;
  const metrics = [];
  const probes = [];
  for (const [nodeIndex, node] of selected.entries()) {
    for (let step = 0; step < steps; step += 1) {
      const timestamp = now - (steps - 1 - step) * bucket;
      const cycle = step / 9 + nodeIndex * 0.7;
      metrics.push({
        node_id: node.id, timestamp,
        cpu_percent: Math.max(1, node.resources[0] + Math.sin(cycle) * 7 + (step % 67 === 0 ? 19 : 0)),
        memory_used_percent: Math.max(1, node.resources[1] + Math.sin(cycle / 3) * 4),
        disk_used_percent: node.resources[2] + (step / steps) * 0.4,
        network_rx_rate_bps: 150000 + Math.abs(Math.sin(cycle * 1.7)) * 620000,
        network_tx_rate_bps: 70000 + Math.abs(Math.cos(cycle * 1.4)) * 280000,
      });
      for (const probe of probeDefinitions(node)) {
        const burst = step % 83 >= 79 ? probe.base * 0.38 : 0;
        const loss = step % 97 === 93 ? 8 : step % 47 === 31 ? 2 : 0;
        const missing = step % 113 === 42;
        probes.push({
          node_id: node.id, probe_name: probe.name, label: probe.label, category: probe.category, kind: "icmp", timestamp,
          latency_ms: missing ? null : Math.max(1, probe.base + Math.sin(cycle + probe.order) * Math.max(1.5, probe.base * 0.04) + burst),
          packet_loss_percent: missing ? 100 : loss,
          sample_failure_percent: missing ? 100 : loss,
          success_percent: missing ? 0 : 100,
          rounds: 1,
          warning_ms: probe.base * 1.35, critical_ms: probe.base * 1.7,
          warning_failure_percent: 1, critical_failure_percent: 5,
        });
      }
    }
  }
  return {
    schema_version: 2, server_time: now, hours, bucket_seconds: bucket, selected_node: selectedNode || null,
    catalog: { nodes: nodeDefinitions.map((node, index) => ({ id: node.id, label: node.label, order: index + 1 })) },
    metrics, probes,
    annotations: selectedNode ? [
      { node_id: selectedNode, timestamp: now - Math.min(hours * 1800, 5 * 3600), severity: "INFO", title: "Agent 启动", detail: "监控进程完成一次正常重启" },
      { node_id: selectedNode, timestamp: now - Math.min(hours * 900, 2 * 3600), severity: "P2", title: "线路出现短时波动", detail: "连续采样后已恢复到正常范围" },
    ] : [],
  };
}

function json(response, status = 200) {
  return { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }, body: JSON.stringify(response) };
}

async function handle(request) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === "/api/v1/dashboard/latest") return json(latestData());
  if (url.pathname === "/api/v1/dashboard/history") {
    const hours = [6, 24, 168, 720, 2160].includes(Number(url.searchParams.get("hours"))) ? Number(url.searchParams.get("hours")) : 24;
    return json(historyData(hours, url.searchParams.get("node")));
  }
  if (url.pathname === "/auth/logout") return { status: 204, headers: {}, body: "" };
  const relative = url.pathname === "/" || url.pathname === "/dashboard" || url.pathname === "/dashboard/"
    ? "dashboard/index.html"
    : url.pathname.replace(/^\/+/, "");
  const absolute = resolve(publicRoot, relative);
  if (absolute !== publicRoot && !absolute.startsWith(`${publicRoot}${sep}`)) return { status: 403, headers: {}, body: "Forbidden" };
  try {
    return { status: 200, headers: { "content-type": mimeTypes.get(extname(absolute)) || "application/octet-stream", "cache-control": "no-store" }, body: await readFile(absolute) };
  } catch {
    return { status: 404, headers: { "content-type": "text/plain; charset=utf-8" }, body: "Not found" };
  }
}

const server = createServer(async (request, response) => {
  const result = await handle(request);
  response.writeHead(result.status, result.headers);
  response.end(result.body);
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Dashboard preview ready at http://127.0.0.1:${port}/dashboard/\n`);
});
