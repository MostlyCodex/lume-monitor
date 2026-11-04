// Fictional, deterministic fixtures. No network, credentials or production data.
// The shapes match the dashboard API exactly: only fields the page displays.
export function createDemoData(previewNow = Math.floor(Date.now() / 1000)) {
const nodeDefinitions = [
  { id: "transit-la", label: "Transit-Los-Angeles", region: "Los Angeles", country: "US", service: ["nftables", "nftables"], bases: [151, 158, 181, 8], resources: [18.4, 34.2, 28.5] },
  { id: "transit-eb", label: "Transit-Edge-Bridge", region: "Los Angeles", country: "US", service: ["nftables", "nftables"], bases: [155, 164, 188, 9], resources: [11.6, 27.8, 41.3] },
  { id: "egress-lv", label: "Egress-Las-Vegas", region: "Las Vegas", country: "US", service: ["xray", "Xray"], bases: [42], resources: [22.7, 43.6, 67.4] },
  { id: "hybrid-la", label: "Hybrid-LAX-Tri", region: "Los Angeles", country: "US", service: ["xray", "Xray"], bases: [149, 157, 179], resources: [9.8, 31.4, 23.6] },
  { id: "transit-tokyo", label: "Transit-Tokyo", region: "Tokyo", country: "JP", service: ["nftables", "nftables"], bases: [63, 69, 78, 7], resources: [14.1, 76.8, 35.2] },
  { id: "hybrid-sg", label: "Hybrid-Singapore", region: "Singapore", country: "SG", service: ["xray", "Xray"], bases: [72, 78, 91], resources: [31.5, 52.7, 87.2] },
];

function probeDefinitions(node) {
  if (node.id === "egress-lv") return [{ name: "public-connectivity", label: "外网连通性", category: "external", base: node.bases[0], order: 1 }];
  const probes = [
    // 与 Worker 一致：三网只显示运营商，节点互联只显示目标节点名称
    { name: "carrier-ct", label: "电信", category: "carrier-reference", base: node.bases[0], order: 1 },
    { name: "carrier-cu", label: "联通", category: "carrier-reference", base: node.bases[1], order: 2 },
    { name: "carrier-cm", label: "移动", category: "carrier-reference", base: node.bases[2], order: 3 },
  ];
  if (node.bases[3]) probes.push({ name: "node-link", label: "Egress-Las-Vegas", category: "node-link", base: node.bases[3], order: 4 });
  if (node.id === "transit-la") probes.push({ name: "peer-tcp-443", label: "Egress-Las-Vegas", category: "node-link", kind: "tcp", base: 12, order: 5 });
  return probes;
}

// 确定性伪随机：同一节点、线路、时刻总是得到同一个值，截图和测试可复现
function noise(...parts) {
  let hash = 2166136261;
  for (const character of parts.join("|")) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0x5bd1e995);
  hash ^= hash >>> 15;
  return (hash >>> 0) / 4294967296;
}

// 平滑噪声：相邻时段之间缓慢起伏，避免锯齿和规则正弦
function drift(seed, timestamp, period) {
  const slot = Math.floor(timestamp / period);
  const fraction = timestamp / period - slot;
  const eased = fraction * fraction * (3 - 2 * fraction);
  const from = noise(seed, slot);
  return from + (noise(seed, slot + 1) - from) * eased;
}

// 国内晚高峰（北京时间 21:30 前后）
function eveningPeak(timestamp) {
  const hour = (((timestamp / 3600 + 8) % 24) + 24) % 24;
  const distance = hour - 21.5;
  return Math.exp(-(distance * distance) / (2 * 1.6 * 1.6));
}

const PEAK_AMPLITUDE = { "carrier-ct": 0.04, "carrier-cu": 0.09, "carrier-cm": 0.12 };

// 少数几次异常，其余时间平稳：新加坡移动正在拥塞，洛杉矶联通 9 小时前短暂丢包，
// 东京移动 15 小时前绕路变慢，Edge-Bridge 6 小时前 Agent 重启断报 20 分钟。
function incident(node, probe, timestamp) {
  const ago = previewNow - timestamp;
  if (node.id === "hybrid-sg" && probe.name === "carrier-cm" && ago < 2.5 * 3600)
    return { slow: 1.38 + noise(node.id, probe.name, "slow", timestamp) * 0.08, loss: 3 + noise(node.id, probe.name, "loss", timestamp) * 5 };
  if (node.id === "transit-la" && probe.name === "carrier-cu" && ago >= 8.4 * 3600 && ago < 9 * 3600)
    return { slow: 1.22, loss: 5 + noise(node.id, probe.name, "loss", timestamp) * 6 };
  if (node.id === "transit-tokyo" && probe.name === "carrier-cm" && ago >= 14 * 3600 && ago < 15 * 3600)
    return { slow: 1.55, loss: 0 };
  return { slow: 1, loss: 0 };
}

function agentOffline(node, timestamp) {
  const ago = previewNow - timestamp;
  return node.id === "transit-eb" && ago >= 6 * 3600 && ago < 6 * 3600 + 20 * 60;
}

function latencyAt(node, probe, timestamp) {
  const seed = `${node.id}/${probe.name}`;
  const amplitude = (PEAK_AMPLITUDE[probe.name] ?? 0.01) * (node.country === "US" ? 1 : 0.6);
  const jitter = noise(seed, "spike", Math.floor(timestamp / 300)) < 0.006 ? 0.08 : 0;
  const ratio =
    1 +
    amplitude * eveningPeak(timestamp) +
    0.03 * (drift(seed, timestamp, 1800) - 0.5) +
    0.015 * (noise(seed, timestamp) - 0.5) +
    jitter;
  return probe.base * ratio * incident(node, probe, timestamp).slow;
}

// 偶发单包丢失只出现在美国节点的联通、移动线路上，24 小时丢包率不到 0.1%
function lossAt(node, probe, timestamp, rounds) {
  const planned = incident(node, probe, timestamp).loss;
  if (planned) return planned;
  const sporadic = node.country === "US" && (probe.name === "carrier-cu" || probe.name === "carrier-cm");
  return sporadic && noise(node.id, probe.name, "drop", timestamp) < Math.min(0.5, 0.004 * rounds)
    ? 100 / (rounds * 5)
    : 0;
}

function currentProbe(node, probe) {
  const congested = incident(node, probe, previewNow).loss > 0;
  return {
    name: probe.name,
    label: probe.label,
    category: probe.category,
    kind: /** @type {"tcp"} */ ("tcp"),
    order: probe.order,
    success: true,
    complete: true,
    duration_ms: Math.round(latencyAt(node, probe, previewNow) * 10) / 10,
    samples: 5,
    packet_loss_percent: congested ? 20 : 0,
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
    probes: probeDefinitions(definition).map((probe) => currentProbe(definition, probe)),
  }));
  return {
    schema_version: 2,
    server_time: now,
    catalog: {
      known_node_ids: nodeDefinitions.map((node) => node.id),
      nodes: nodeDefinitions.map((node, index) => ({ id: node.id, label: node.label, region: node.region, order: index + 1 })),
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
  const rounds = Math.max(1, Math.round(bucket / 60));
  for (const [nodeIndex, node] of selected.entries()) {
    for (let step = 0; step < steps; step += 1) {
      const timestamp = now - (steps - 1 - step) * bucket;
      if (agentOffline(node, timestamp)) continue;
      // 下载随晚高峰起伏，偶有大文件下载的突增
      const busy = 0.45 + 0.7 * eveningPeak(timestamp) + 0.4 * drift(node.id, timestamp, 900);
      const burst = noise(node.id, "burst", Math.floor(timestamp / 600)) < 0.03 ? 2.2 : 1;
      metrics.push({
        node_id: node.id, timestamp,
        network_rx_rate_bps: (160000 + nodeIndex * 40000) * busy * burst,
        network_tx_rate_bps: (80000 + nodeIndex * 18000) * (0.6 + 0.5 * drift(`${node.id}/tx`, timestamp, 1200)) * busy,
      });
      for (const probe of probeDefinitions(node)) {
        probes.push({
          node_id: node.id, probe_name: probe.name, timestamp,
          latency_ms: latencyAt(node, probe, timestamp),
          packet_loss_percent: lossAt(node, probe, timestamp, rounds),
          success_percent: 100,
          rounds,
        });
      }
    }
  }
  return {
    schema_version: 2, server_time: now, hours, selected_node: selectedNode || null,
    metrics, probes,
    annotations: selectedNode ? [
      { node_id: selectedNode, timestamp: now - Math.min(hours * 1800, 6 * 3600), severity: "INFO", title: "Agent 启动", detail: "监控进程完成一次正常重启" },
      { node_id: selectedNode, timestamp: now - Math.min(hours * 900, 2 * 3600), severity: "P2", title: "线路出现短时波动", detail: "连续采样后已恢复到正常范围" },
    ] : [],
  };
}


return { latestData, historyData };
}
