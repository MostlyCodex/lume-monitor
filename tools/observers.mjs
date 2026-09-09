import { isIP } from "node:net";
import { isDeepStrictEqual } from "node:util";
import { InputError, choiceValue, displayText, displayValue, inputValue, integerValue } from "./prompts.mjs";

const maxProbes = 32;

function observerName(value, label = "探针名称") {
  const name = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(name)) throw new InputError(`${label}必须以小写字母或数字开头，只能含小写字母、数字、下划线或连字符，长度 1–80`);
  return name;
}

function nameValue(prompt, question, fallback, entries, line) {
  return inputValue(prompt, question, {
    hint: "1–80 位小写字母、数字、_ 或 -；首位为字母或数字；名称不能重复", fallback, line,
    parse: (value) => {
      const name = observerName(value, question);
      if (entries.some((entry) => entry.name === name)) throw new InputError(`名称 ${name} 已存在，请使用其他名称`);
      return name;
    },
  });
}

export function probeTarget(value) {
  const target = String(value || "").trim();
  if (isIP(target)) return target;
  const hostname = target.replace(/\.$/, "");
  if (!hostname || target.length > 253 || /^[0-9.]+$/.test(hostname) || !hostname.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) {
    throw new InputError("请输入有效 IPv4、IPv6 或主机名；主机名最多 253 字符，每段 1–63 位字母、数字或 -，首尾不能是 -；不含协议、端口或路径");
  }
  return target;
}

function targetValue(prompt, question, line) {
  return inputValue(prompt, question, { hint: "IPv4 / IPv6 / 主机名；主机名最多 253 字符、每段 1–63 位字母数字或 -；不含协议、端口、路径", parse: probeTarget, line });
}

export function parseServices(value) {
  if (!value.trim()) return [];
  const names = value.split(",").map((item) => item.trim());
  if (names.length > 16) throw new InputError("最多配置 16 个 systemd 服务");
  if (names.some((name) => !/^[A-Za-z0-9_.@-]{1,80}$/.test(name))) throw new InputError("每个服务名必须为 1–80 位字母、数字、_ . @ 或 -，用英文逗号分隔，不能有空项");
  if (new Set(names).size !== names.length) throw new InputError("systemd 服务名不能重复");
  return names.map((name) => ({ name, label: name.replace(/\.service$/, ""), severity: "P1" }));
}

export function promptServices(prompt, { line = console.log } = {}) {
  return inputValue(prompt, "systemd 服务", {
    hint: "填写 VPS 上实际存在的 unit，如 nginx.service；0–16 个，英文逗号分隔；每项 1–80 位字母数字或 _ . @ -；回车留空", parse: parseServices, line,
  });
}

function baseProbe(name, label, target, kind, order) {
  return {
    name: observerName(name), label: displayText(label, { label: "探针显示名" }), category: "external", kind,
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
  if (indices.some((index) => !Number.isInteger(index) || index < 0 || index >= count)) throw new InputError(`只能选择列表中的 1–${count} 号，用英文逗号分隔`);
  return [...new Set(indices)];
}

export function mergeObserverEntries(current, additions, { label = "探针", limit = maxProbes } = {}) {
  const merged = [...current];
  for (const entry of additions) {
    const previous = merged.find((item) => item.name === entry.name);
    if (previous && !isDeepStrictEqual(previous, entry)) throw new InputError(`${label} ${entry.name} 名称冲突，请选择其他项或先删除同名项`);
    if (!previous) merged.push(entry);
  }
  if (new Set(merged.map((entry) => entry.name)).size !== merged.length) throw new InputError(`${label}名称重复`);
  if (merged.length > limit) throw new InputError(`最多配置 ${limit} 个${label}，当前已有 ${current.length} 个`);
  return merged;
}

function describeProbe(probe) {
  const kind = probe.kind.toUpperCase();
  const label = probe.label || probe.name;
  const title = label.toUpperCase().endsWith(` · ${kind}`) ? label : `${label} · ${kind}`;
  const target = probe.kind === "tcp" && isIP(probe.target) === 6 ? `[${probe.target}]` : probe.target;
  return `${title} → ${target}${probe.kind === "tcp" ? `:${probe.port}` : ""}`;
}

async function reuseProbes(prompt, sources, existing, line) {
  sources.forEach((source, index) => line(`  ${index + 1}. ${source.label} (${source.id}) · ${source.probes.length} 个外部探针`));
  const choice = await integerValue(prompt, "选择要复用的节点编号；0 返回监测方式", 0, sources.length, 1, { line });
  if (choice === 0) return null;
  const source = sources[choice - 1];
  source.probes.forEach((probe, index) => line(`  ${index + 1}. ${describeProbe(probe)}`));
  return inputValue(prompt, "复用哪些探针", {
    hint: `1–${source.probes.length}，英文逗号分隔；回车全部；0 返回监测方式；总数最多 ${maxProbes}`, line,
    parse: (value) => {
      if (value === "0") return null;
      const selected = selectedIndices(value, source.probes.length, { emptyMeansAll: true }).map((index) => source.probes[index]);
      mergeObserverEntries(existing, selected);
      return structuredClone(selected);
    },
  });
}

async function customProbe(prompt, probes, nodes, line) {
  const kind = await choiceValue(prompt, "探针类型：icmp 延迟/丢包；tcp 建连延迟/失败率", ["icmp", "tcp"], "icmp", { line });
  let suffix = probes.length + 1;
  while (probes.some((probe) => probe.name === `${kind}_${suffix}`)) suffix += 1;
  const name = await nameValue(prompt, "探针名称", `${kind}_${suffix}`, probes, line);
  const label = await displayValue(prompt, "面板显示名", `${kind.toUpperCase()} ${suffix}`, { line });
  const target = await targetValue(prompt, "目标主机名或 IP", line);
  const probe = baseProbe(name, label, target, kind, (probes.length + 1) * 10);
  if (kind === "tcp") {
    probe.port = await integerValue(prompt, "TCP 端口", 1, 65535, 443, { line });
    probe.connect_timeout_ms = 1000;
  }
  const peer = nodes.length ? await inputValue(prompt, "目标节点 ID", {
    hint: `仅可选 ${nodes.join(" / ")}；外部目标回车留空`, line,
    parse: (value) => {
      if (value && !nodes.includes(value)) throw new InputError(`只能选择已登记的其他活动节点：${nodes.join(" / ")}，或留空作为外部目标`);
      return value;
    },
  }) : "";
  if (peer) {
    probe.target_node_id = peer;
    probe.category = "node-link";
  }
  return probe;
}

export async function promptNetworkProbes(prompt, { sources = [], nodes = [], existing = [], line = console.log } = {}) {
  line("\n网络质量监测：三网延迟/丢包需要 ICMP 探针，请在这里选择。");
  line(`每节点最多 ${maxProbes} 个网络探针，当前保留 ${existing.length} 个。`);
  line("  1. 三网 ICMP 向导（电信 / 联通 / 移动）\n  2. 复用已有节点的外部探针（三网等）\n  3. 自定义 ICMP / TCP\n  0. 暂不配置网络探针");
  let choice, probes;
  while (true) {
    choice = await choiceValue(prompt, "选择网络质量监测方式", ["0", "1", "2", "3"], sources.length ? "2" : "1", { line });
    if (choice === "2" && !sources.length) { line("没有可复用的外部探针，请选择三网向导、自定义探针或暂不配置。"); continue; }
    if (choice === "1" && existing.length + 3 > maxProbes) { line(`三网需要 3 个探针名额，当前只剩 ${maxProbes - existing.length} 个，请选择其他方式。`); continue; }
    if (choice === "2") {
      probes = await reuseProbes(prompt, sources, existing, line);
      if (probes === null) continue;
    } else probes = [];
    break;
  }
  if (choice === "0") { line("未配置网络探针；主机资源和网卡流量仍会采集。"); return probes; }
  if (choice === "1") {
    line("填写三个运营商的参考目标。已有节点配置过三网时，可用选项 2 直接复用。");
    const region = await displayValue(prompt, "目标地区（如北京）", "", { max: 66, optional: true, line });
    const prefix = await inputValue(prompt, "这组探针的名称前缀", {
      hint: "1–77 位小写字母、数字、_ 或 -；首位为字母或数字；生成的 _ct / _cu / _cm 名称不能重复", fallback: "carrier", line,
      parse: (value) => {
        if (!/^[a-z0-9][a-z0-9_-]{0,76}$/.test(value)) throw new InputError("前缀必须为 1–77 位小写字母、数字、_ 或 -，首位为字母或数字");
        if (["ct", "cu", "cm"].some((suffix) => existing.some((probe) => probe.name === `${value}_${suffix}`))) throw new InputError("这组探针名称已存在，请使用其他前缀");
        return value;
      },
    });
    const targets = {};
    for (const [key, label] of [["ct", "电信"], ["cu", "联通"], ["cm", "移动"]]) targets[key] = await targetValue(prompt, `${label}参考目标的 IP 或主机名`, line);
    probes = createCarrierProbes({ region, prefix, targets });
  }
  while (mergeObserverEntries(existing, probes).length < maxProbes && await prompt.yes("添加自定义 ICMP / TCP 探针", choice === "3" && probes.length === 0)) {
    probes.push(await customProbe(prompt, mergeObserverEntries(existing, probes), nodes, line));
  }
  return mergeObserverEntries([], probes);
}

function nftIdentifier(value, label) {
  const text = String(value || "").trim();
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(text)) throw new InputError(`${label}只能包含 1–64 位字母、数字、_ . 或 -`);
  return text;
}

export async function promptNftablesCounters(prompt, { existing = [], line = console.log } = {}) {
  const counters = [];
  line("\nnftables：可选的已有防火墙规则命中计数，与三网 ICMP 配置独立。");
  line(`每节点最多 16 个计数器，当前保留 ${existing.length} 个。`);
  while (existing.length + counters.length < 16 && await prompt.yes("添加 nftables 规则计数器", false)) {
    const entries = [...existing, ...counters];
    let suffix = entries.length + 1;
    while (entries.some((entry) => entry.name === `nft_counter_${suffix}`)) suffix += 1;
    const name = await nameValue(prompt, "计数器名称", `nft_counter_${suffix}`, entries, line);
    const label = await displayValue(prompt, "面板显示名", `规则 ${suffix}`, { line });
    const family = await choiceValue(prompt, "nftables family", ["ip", "ip6", "inet"], "ip", { line });
    const identifiers = {};
    for (const field of ["table", "chain"]) identifiers[field] = await inputValue(prompt, `${field} 名称`, {
      hint: "VPS 上实际存在的名称，区分大小写；1–64 位字母、数字、_ . 或 -", line, parse: (value) => nftIdentifier(value, field),
    });
    const { table, chain } = identifiers;
    const protocol = await choiceValue(prompt, "传输协议", ["tcp", "udp"], "tcp", { line });
    const destinationPort = await integerValue(prompt, "规则匹配的目标端口", 1, 65535, 443, { line });
    const comment = await inputValue(prompt, "规则 comment", {
      hint: "与规则 comment 精确匹配，最多 80 字节，无控制字符；同链同端口多条规则时必填，否则可留空", line,
      parse: (value) => displayText(value, { label: "规则 comment", optional: true }),
    });
    counters.push({ name, label, family, table, chain, protocol, destination_port: destinationPort,
      ...(comment ? { rule_comment: comment } : {}), display_order: (counters.length + 1) * 10 });
  }
  return counters;
}

export async function editObserverEntries(prompt, { label, entries, create, limit, line = console.log, fallback = "1" }) {
  const action = await inputValue(prompt, `${label}：1 保留 / 2 追加 / 3 重新配置 / 4 删除指定项`, {
    hint: `可选 1–4；当前 ${entries.length}/${limit} 项`, fallback, line,
    parse: (value) => {
      if (!["1", "2", "3", "4"].includes(value)) throw new InputError("请选择 1 / 2 / 3 / 4");
      if (value === "2" && entries.length >= limit) throw new InputError(`已达到 ${limit} 项上限，请保留、删除或重新配置`);
      if (value === "4" && !entries.length) throw new InputError("当前没有可删除的项目，请选择保留、追加或重新配置");
      return value;
    },
  });
  if (action === "1") return entries;
  if (action === "2" || action === "3") {
    const existing = action === "2" ? entries : [];
    return mergeObserverEntries(existing, await create({ existing }), { label, limit });
  }
  entries.forEach((entry, index) => line(`  ${index + 1}. ${entry.label || entry.name} (${entry.name})`));
  const selected = await inputValue(prompt, `删除${label}的编号`, {
    hint: `1–${entries.length}，英文逗号分隔；回车全部保留`, line, parse: (value) => selectedIndices(value, entries.length),
  });
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
