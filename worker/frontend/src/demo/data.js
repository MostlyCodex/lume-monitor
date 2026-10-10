// Fictional, deterministic fixtures. No network, credentials or production data.
// The shapes match the dashboard API exactly: only fields the page displays.
export function createDemoData(previewNow = Math.floor(Date.now() / 1000)) {
const nodeDefinitions = [
  { id: "transit-la", label: "Transit-Los-Angeles", role: "线路中转机", region: "Los Angeles", country: "US", service: ["nftables", "nftables"], bases: [151, 158, 181, 8], resources: [18.4, 34.2, 28.5] },
  { id: "transit-eb", label: "Transit-Edge-Bridge", role: "线路中转机", region: "Los Angeles", country: "US", service: ["nftables", "nftables"], bases: [155, 164, 188, 9], resources: [11.6, 27.8, 41.3] },
  { id: "egress-lv", label: "Egress-Las-Vegas", role: "住宅出口落地机", region: "Las Vegas", country: "US", service: ["xray", "Xray"], bases: [42], resources: [22.7, 43.6, 67.4] },
  { id: "hybrid-la", label: "Hybrid-LAX-Tri", role: "线路 + 落地机", region: "Los Angeles", country: "US", service: ["xray", "Xray"], bases: [149, 157, 179], resources: [9.8, 31.4, 23.6] },
  { id: "transit-tokyo", label: "Transit-Tokyo", role: "线路中转机", region: "Tokyo", country: "JP", service: ["nftables", "nftables"], bases: [63, 69, 78, 7], resources: [14.1, 76.8, 35.2] },
  { id: "hybrid-sg", label: "Hybrid-Singapore", role: "线路 + 落地机", region: "Singapore", country: "SG", service: ["xray", "Xray"], bases: [72, 78, 91], resources: [31.5, 52.7, 87.2] },
];

function probeDefinitions(node) {
  if (node.id === "egress-lv") return [{ name: "public-connectivity", label: "外网连通性", category: "external", base: node.bases[0], order: 1 }];
  const probes = [
    { name: "beijing-ct", label: "北京电信", category: "carrier", base: node.bases[0], order: 1 },
    { name: "beijing-cu", label: "北京联通", category: "carrier", base: node.bases[1], order: 2 },
    { name: "beijing-cm", label: "北京移动", category: "carrier", base: node.bases[2], order: 3 },
  ];
  if (node.bases[3]) probes.push({ name: "node-link", label: `${node.label} → Egress-Las-Vegas`, category: "node-link", base: node.bases[3], order: 4 });
  if (node.id === "transit-la") probes.push({ name: "peer-tcp-443", label: "Egress-Las-Vegas · TCP 443", category: "node-link", kind: "tcp", base: 12, order: 5 });
  return probes;
}

function currentProbe(node, probe, index) {
  const elevated = node.id === "hybrid-sg" && probe.name === "beijing-cm";
  const icmp = probe.kind !== "tcp";
  return {
    name: probe.name,
    label: probe.label,
    category: probe.category,
    kind: /** @type {"icmp" | "tcp"} */ (icmp ? "icmp" : "tcp"),
    order: probe.order,
    warning_ms: probe.base * 1.35,
    critical_ms: probe.base * 1.7,
    warning_failure_percent: icmp ? 1 : null,
    critical_failure_percent: icmp ? 5 : null,
    success: true,
    complete: true,
    duration_ms: Math.round((elevated ? probe.base * 1.42 : probe.base + Math.sin(index + 0.8) * 3) * 10) / 10,
    samples: icmp ? 20 : 3,
    packet_loss_percent: icmp ? (elevated ? 5 : 0) : null,
  };
}

// 演示节点的本月流量：用量随月内天数增长
function demoTrafficCycle(nodeIndex) {
  const date = new Date(previewNow * 1000);
  const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1000;
  const days = Math.max(1, (previewNow - start) / 86400);
  return {
    rx_bytes: Math.round(days * (2.7 + nodeIndex * 0.55) * 1024 ** 3),
    tx_bytes: Math.round(days * (1.4 + nodeIndex * 0.3) * 1024 ** 3),
  };
}

function latestData() {
  const now = previewNow;
  const nodes = nodeDefinitions.map((definition, nodeIndex) => ({
    id: definition.id,
    label: definition.label,
    role: definition.role,
    region: definition.region,
    order: nodeIndex + 1,
    online: true,
    received_at: now - 18 - nodeIndex * 5,
    country: definition.country,
    system: { hostname: definition.id, os: "Debian GNU/Linux 12", kernel: "6.1.0" },
    metrics: {
      cpu_percent: definition.resources[0], memory_used_percent: definition.resources[1], disk_used_percent: definition.resources[2],
      cpu_count: 1 + (nodeIndex % 4),
      memory_total_bytes: 1024 ** 3 * (1 + (nodeIndex % 3)),
      disk_total_bytes: 1024 ** 3 * (20 + nodeIndex * 5),
      uptime_seconds: 86400 * (18 + nodeIndex * 7) + 3600 * nodeIndex,
      network_interfaces: ["eth0"],
      network_valid: true,
      traffic_cycle: demoTrafficCycle(nodeIndex),
      network_rx_rate_bps: 180000 + nodeIndex * 46000, network_tx_rate_bps: 92000 + nodeIndex * 22000,
    },
    services: [{ name: definition.service[0], label: definition.service[1], state: "active" }],
    probes: probeDefinitions(definition).map((probe, index) => currentProbe(definition, probe, index)),
  }));
  return {
    schema_version: 2,
    server_time: now,
    catalog: {
      known_node_ids: nodeDefinitions.map((node) => node.id),
      nodes: nodeDefinitions.map((node, index) => ({ id: node.id, label: node.label, role: node.role, region: node.region, order: index + 1 })),
    },
    nodes,
  };
}

function historyData(hours, selectedNode) {
  const now = previewNow;
  const bucket = hours <= 24 ? (selectedNode ? 60 : 300) : hours <= 720 ? 3600 : 86400;
  const maximumSteps = selectedNode && hours <= 24 ? 1440 : 720;
  const steps = Math.min(maximumSteps, Math.max(12, Math.floor((hours * 3600) / bucket)));
  const selected = selectedNode ? nodeDefinitions.filter((node) => node.id === selectedNode) : nodeDefinitions;
  const metrics = [];
  const probes = [];
  for (const [nodeIndex, node] of selected.entries()) {
    for (let step = 0; step < steps; step += 1) {
      const timestamp = now - (steps - 1 - step) * bucket;
      const cycle = step / 9 + nodeIndex * 0.7;
      metrics.push({
        node_id: node.id, timestamp,
        network_rx_rate_bps: 150000 + Math.abs(Math.sin(cycle * 1.7)) * 620000,
        network_tx_rate_bps: 70000 + Math.abs(Math.cos(cycle * 1.4)) * 280000,
      });
      for (const probe of probeDefinitions(node)) {
        const burst = step % 83 >= 79 ? probe.base * 0.38 : 0;
        const loss = step % 97 === 93 ? 8 : step % 47 === 31 ? 2 : 0;
        const missing = step % 113 === 42;
        probes.push({
          node_id: node.id, probe_name: probe.name, timestamp,
          latency_ms: missing ? null : Math.max(1, probe.base + Math.sin(cycle + probe.order) * Math.max(1.5, probe.base * 0.04) + burst),
          packet_loss_percent: probe.kind === "tcp" ? null : missing ? 100 : loss,
          success_percent: missing ? 0 : 100,
          rounds: 1,
        });
      }
    }
  }
  return {
    schema_version: 2, server_time: now, hours, selected_node: selectedNode || null,
    metrics, probes,
    annotations: selectedNode ? [
      { node_id: selectedNode, timestamp: now - Math.min(hours * 1800, 5 * 3600), severity: "INFO", title: "Agent 启动", detail: "监控进程完成一次正常重启" },
      { node_id: selectedNode, timestamp: now - Math.min(hours * 900, 2 * 3600), severity: "P2", title: "线路出现短时波动", detail: "连续采样后已恢复到正常范围" },
    ] : [],
  };
}


return { latestData, historyData };
}
