import { isIP } from "node:net";
import { nodeIdPattern, restorePeerProbes } from "./management.mjs";

const maxProbes = 32;

function observerName(value, label = "探针名称") {
  const name = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(name)) throw new Error(`${label}必须使用小写字母、数字、下划线或连字符，最长 80 字符`);
  return name;
}

function displayText(value, label) {
  const text = String(value || "").trim();
  if (!text || Buffer.byteLength(text) > 80 || /[\r\n\t]/.test(text)) throw new Error(`${label}不能为空或超过 80 字节`);
  return text;
}

export function probeTarget(value) {
  const target = String(value || "").trim();
  if (isIP(target)) return target;
  const hostname = target.replace(/\.$/, "");
  if (!hostname || target.length > 253 || !hostname.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) {
    throw new Error("探测目标必须是单独的主机名或 IP，不含协议、端口或路径");
  }
  return target;
}

function baseProbe(name, label, target, kind, order) {
  return {
    name: observerName(name), label: displayText(label, "探针显示名"), category: "external", kind,
    target: probeTarget(target), timeout_seconds: 4, samples: kind === "icmp" ? 5 : 3,
    sample_interval_ms: 250, warning_ms: 500, critical_ms: 1500,
    warning_failure_percent: 1, critical_failure_percent: 60, severity: "P2", display_order: order,
  };
}

export function createCarrierProbes({ targets, region = "", prefix = "carrier" }) {
  return [["ct", "电信"], ["cu", "联通"], ["cm", "移动"]].map(([key, label], index) => ({
    ...baseProbe(`${prefix}_${key}`, `${region}${label} · ICMP`, targets[key], "icmp", (index + 1) * 10),
    category: "carrier-reference",
  }));
}

export function externalProbes(config) {
  return structuredClone((config.probes || []).filter((probe) =>
    ["icmp", "tcp"].includes(probe.kind) && !probe.target_node_id && probe.category !== "node-link"));
}

export function selectedIndices(value, count, { emptyMeansAll = false } = {}) {
  if (!value.trim()) return emptyMeansAll ? Array.from({ length: count }, (_, index) => index) : [];
  const indices = value.split(",").map((part) => /^\d+$/.test(part.trim()) ? Number(part.trim()) - 1 : -1);
  if (indices.some((index) => !Number.isInteger(index) || index < 0 || index >= count)) throw new Error("选择编号不在列表中");
  return [...new Set(indices)];
}

export function mergeObserverEntries(current, additions, { label = "探针", limit = maxProbes } = {}) {
  const merged = restorePeerProbes(current, additions);
  if (new Set(merged.map((entry) => entry.name)).size !== merged.length) throw new Error(`${label}名称重复`);
  if (merged.length > limit) throw new Error(`最多配置 ${limit} 个${label}`);
  return merged;
}

function describeProbe(probe) {
  const kind = probe.kind.toUpperCase();
  const label = probe.label || probe.name;
  const title = label.toUpperCase().endsWith(` · ${kind}`) ? label : `${label} · ${kind}`;
  const target = probe.kind === "tcp" && isIP(probe.target) === 6 ? `[${probe.target}]` : probe.target;
  return `${title} → ${target}${probe.kind === "tcp" ? `:${probe.port}` : ""}`;
}

async function reuseProbes(prompt, sources, line) {
  sources.forEach((source, index) => line(`  ${index + 1}. ${source.label} (${source.id}) · ${source.probes.length} 个外部探针`));
  const choice = await prompt.text("选择要复用的节点编号", "1");
  const indices = selectedIndices(choice, sources.length);
  if (indices.length !== 1) throw new Error("请选择一个来源节点");
  const source = sources[indices[0]];
  source.probes.forEach((probe, index) => line(`  ${index + 1}. ${describeProbe(probe)}`));
  const selected = selectedIndices(await prompt.text("复用哪些探针（逗号分隔，回车全部）"), source.probes.length, { emptyMeansAll: true });
  return structuredClone(selected.map((index) => source.probes[index]));
}

async function customProbe(prompt, probes) {
  const kind = (await prompt.text("探针类型（icmp 延迟/丢包，tcp 建连延迟/失败率）", "icmp")).toLowerCase();
  if (!["icmp", "tcp"].includes(kind)) throw new Error("探针类型只能为 icmp 或 tcp");
  let suffix = probes.length + 1;
  while (probes.some((probe) => probe.name === `${kind}_${suffix}`)) suffix += 1;
  const name = await prompt.text("探针名称（字母、数字、下划线或连字符）", `${kind}_${suffix}`);
  const label = await prompt.text("面板显示名", `${kind.toUpperCase()} ${suffix}`);
  const target = await prompt.text("目标主机名或 IP（不含端口）");
  const probe = baseProbe(name, label, target, kind, (probes.length + 1) * 10);
  if (probes.some((entry) => entry.name === probe.name)) throw new Error(`探针名称重复：${probe.name}`);
  if (kind === "tcp") {
    probe.port = Number(await prompt.text("TCP 端口", "443"));
    if (!Number.isInteger(probe.port) || probe.port < 1 || probe.port > 65535) throw new Error("TCP 端口必须是 1–65535 的整数");
    probe.connect_timeout_ms = 1000;
  }
  const peer = (await prompt.text("目标节点 ID（外部目标留空）")).toLowerCase();
  if (peer) {
    if (!nodeIdPattern.test(peer)) throw new Error("目标节点 ID 格式无效");
    probe.target_node_id = peer;
    probe.category = "node-link";
  }
  return probe;
}

export async function promptNetworkProbes(prompt, { sources = [], line = console.log } = {}) {
  line("\n网络质量监测：三网延迟/丢包需要 ICMP 探针，请在这里选择。");
  line("  1. 三网 ICMP 向导（电信 / 联通 / 移动）\n  2. 复用已有节点的外部探针（三网等）\n  3. 自定义 ICMP / TCP\n  0. 暂不配置网络探针");
  let choice;
  while (true) {
    choice = await prompt.text("选择网络质量监测方式", sources.length ? "2" : "1");
    if (!["0", "1", "2", "3"].includes(choice)) { line("请输入 0–3。"); continue; }
    if (choice === "2" && !sources.length) { line("没有可复用的外部探针，请选择三网向导、自定义探针或暂不配置。"); continue; }
    break;
  }
  let probes = [];
  if (choice === "0") { line("未配置网络探针；主机资源和网卡流量仍会采集。"); return probes; }
  if (choice === "1") {
    line("填写三个运营商的参考目标。已有节点配置过三网时，可用选项 2 直接复用。");
    const region = await prompt.text("目标地区（用于显示，如北京；可留空）");
    const prefix = await prompt.text("这组探针的名称前缀（多组时用不同前缀）", "carrier");
    const targets = {};
    for (const [key, label] of [["ct", "电信"], ["cu", "联通"], ["cm", "移动"]]) targets[key] = probeTarget(await prompt.text(`${label}参考目标的 IP 或主机名`));
    probes = createCarrierProbes({ region, prefix, targets });
  } else if (choice === "2") {
    probes = await reuseProbes(prompt, sources, line);
  } else if (choice !== "3") throw new Error("请选择 0–3");
  while (probes.length < maxProbes && await prompt.yes("添加自定义 ICMP / TCP 探针", choice === "3" && probes.length === 0)) {
    probes.push(await customProbe(prompt, probes));
  }
  return mergeObserverEntries([], probes);
}

function nftIdentifier(value, label) {
  const text = String(value || "").trim();
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(text)) throw new Error(`${label}格式无效`);
  return text;
}

export async function promptNftablesCounters(prompt, { line = console.log } = {}) {
  const counters = [];
  line("\nnftables：可选的已有防火墙规则命中计数，与三网 ICMP 配置独立。");
  while (counters.length < 16 && await prompt.yes("添加 nftables 规则计数器", false)) {
    const name = observerName(await prompt.text("计数器名称", `nft_counter_${counters.length + 1}`), "计数器名称");
    if (counters.some((counter) => counter.name === name)) throw new Error(`计数器名称重复：${name}`);
    const label = displayText(await prompt.text("面板显示名", `规则 ${counters.length + 1}`), "计数器显示名");
    const family = (await prompt.text("nftables family（ip / ip6 / inet）", "ip")).toLowerCase();
    if (!["ip", "ip6", "inet"].includes(family)) throw new Error("family 只能是 ip、ip6 或 inet");
    const table = nftIdentifier(await prompt.text("table 名称"), "table 名称");
    const chain = nftIdentifier(await prompt.text("chain 名称"), "chain 名称");
    const protocol = (await prompt.text("传输协议（tcp / udp）", "tcp")).toLowerCase();
    if (!["tcp", "udp"].includes(protocol)) throw new Error("传输协议只能是 tcp 或 udp");
    const destinationPort = Number(await prompt.text("规则匹配的目标端口", "443"));
    if (!Number.isInteger(destinationPort) || destinationPort < 1 || destinationPort > 65535) throw new Error("目标端口必须是 1–65535 的整数");
    const comment = await prompt.text("规则 comment（同链同端口多条规则时必填；可留空）");
    if (Buffer.byteLength(comment) > 80 || /[\r\n\t]/.test(comment)) throw new Error("规则 comment 不能超过 80 字节");
    counters.push({ name, label, family, table, chain, protocol, destination_port: destinationPort,
      ...(comment ? { rule_comment: comment } : {}), display_order: (counters.length + 1) * 10 });
  }
  return counters;
}

export async function editObserverEntries(prompt, { label, entries, create, limit, line = console.log, fallback = "1" }) {
  const action = await prompt.text(`${label}：1 保留 / 2 追加 / 3 重新配置 / 4 删除指定项`, fallback);
  if (action === "1") return entries;
  if (action === "2" || action === "3") return mergeObserverEntries(action === "2" ? entries : [], await create(), { label, limit });
  if (action !== "4") throw new Error("请选择 1–4");
  entries.forEach((entry, index) => line(`  ${index + 1}. ${entry.label || entry.name} (${entry.name})`));
  const selected = selectedIndices(await prompt.text(`删除${label}的编号（逗号分隔，留空保留）`), entries.length);
  return entries.filter((_entry, index) => !selected.includes(index));
}

export function printObserverSummary(config, line = console.log) {
  line(`\n监测配置 · ${config.node.display_name || config.node.id} (${config.node.id})`);
  line("  主机资源：CPU、内存、磁盘和网卡流量");
  line(`  systemd 服务：${config.services.length ? config.services.map((service) => service.name).join("、") : "未配置"}`);
  line(`  网络探针：${config.probes.length ? `${config.probes.length} 个` : "未配置（没有三网延迟/丢包检测）"}`);
  for (const probe of config.probes) line(`    ${describeProbe(probe)}`);
  const counters = config.nftables_counters || [];
  line(`  nftables 计数器：${counters.length ? `${counters.length} 个` : "未配置"}`);
  for (const counter of counters) line(`    ${counter.label || counter.name} · ${counter.family}/${counter.table}/${counter.chain} · ${counter.protocol}:${counter.destination_port}`);
}
