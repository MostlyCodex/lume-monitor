import { isIP } from "node:net";
import { isDeepStrictEqual } from "node:util";
import { InputError, PromptBack, PromptCancelled, PromptClosed, promptFields, choiceValue, displayText, displayValue, inputValue, integerValue } from "./prompts.mjs";

const maxProbes = 32;

function observerName(value, label = "探针名称") {
  const name = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(name)) throw new InputError(`${label}必须以小写字母或数字开头，只能含小写字母、数字、下划线或连字符，长度 1–80`);
  return name;
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

function targetValue(prompt, question, line, fallback = "") {
  return inputValue(prompt, question, { hint: "IPv4 / IPv6 / 主机名；主机名最多 253 字符、每段 1–63 位字母数字或 -；不含协议、端口、路径", parse: probeTarget, line, fallback });
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

const maxPublicSites = 2;

// Every probe is a TCP handshake round. 900 ms stays under Linux's 1 s SYN
// retransmit, so a lost handshake counts as loss rather than a late success;
// five samples per round keep the loss resolution at 20%.
function tcpProbe(name, label, target, port, order) {
  return {
    name: observerName(name), label: displayText(label, { label: "探针显示名" }), category: "external", kind: "tcp",
    target: probeTarget(target), port, timeout_seconds: 4, connect_timeout_ms: 900, samples: 5, sample_interval_ms: 250,
    severity: "P2", display_order: order,
  };
}

// Carrier references are labelled by carrier only; which city a target sits in is not tracked.
export function createCarrierProbes({ targets, port = 80, prefix = "carrier" }) {
  return [["ct", "电信"], ["cu", "联通"], ["cm", "移动"]].map(([key, label], index) => ({
    ...tcpProbe(`${prefix}_${key}`, `${label} · TCP ${port}`, targets[key], port, (index + 1) * 10),
    category: "carrier-reference",
  }));
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
  const title = label.toUpperCase().includes(` · ${kind}`) ? label : `${label} · ${kind}`;
  const target = probe.kind === "tcp" && isIP(probe.target) === 6 ? `[${probe.target}]` : probe.target;
  return `${title} → ${target}${probe.kind === "tcp" ? `:${probe.port}` : ""}`;
}

function nextProbeName(prefix, entries, suffixes = [""]) {
  let name = prefix, number = 1;
  while (suffixes.some((suffix) => entries.some((entry) => entry.name === `${name}${suffix}`))) name = `${prefix}_${++number}`;
  return name;
}

const isCarrier = (probe) => probe.category === "carrier-reference";
const isPublicSite = (probe) => !probe.target_node_id && probe.category !== "node-link" && !isCarrier(probe);

async function nodeLinkProbe(prompt, probes, nodes, line) {
  const values = await promptFields([
    ["peer", (_values, previous) => {
      nodes.forEach((id, index) => line(`  ${index + 1}. ${id}`));
      return integerValue(prompt, "目标节点编号", 1, nodes.length, previous ?? 1, { line });
    }],
    ["target", (_values, previous) => targetValue(prompt, "目标节点的 IP 或主机名", line, previous)],
    ["port", (_values, previous) => integerValue(prompt, "目标节点上可连的 TCP 端口（如中转入口、Xray 或 SSH）", 1, 65535, previous ?? 22, { line })],
  ], { line });
  const id = nodes[values.peer - 1];
  // The panel names a link after its target node, so the stored label only matters in lumectl.
  return {
    ...tcpProbe(nextProbeName("link", probes), `${id} · TCP ${values.port}`, values.target, values.port, (probes.length + 1) * 10),
    category: "node-link",
    target_node_id: id,
  };
}

async function publicSiteProbe(prompt, probes, line) {
  const values = await promptFields([
    ["target", (_values, previous) => targetValue(prompt, "公网网址的主机名或 IP（如 www.google.com）", line, previous)],
    ["port", (_values, previous) => integerValue(prompt, "TCP 端口", 1, 65535, previous ?? 443, { line })],
    ["label", (values, previous) => displayValue(prompt, "面板显示名", previous ?? values.target, { line })],
  ], { line });
  return tcpProbe(nextProbeName("site", probes), values.label, values.target, values.port, (probes.length + 1) * 10);
}

/**
 * Three kinds of TCP probes only: one carrier set (telecom, unicom, mobile),
 * links to other nodes, and at most two public sites.
 */
export async function promptNetworkProbes(prompt, { nodes = [], existing = [], line = console.log } = {}) {
  while (true) {
    const sites = existing.filter(isPublicSite).length;
    line(`\n网络质量监测（TCP 建连延迟与握手丢失率）· 已配置 ${existing.length} 个探针，最多 ${maxProbes} 个。`);
    line(`  1. 三网（电信 / 联通 / 移动）\n  2. 到其他节点\n  3. 到公网网址（已有 ${sites}/${maxPublicSites} 个）\n  0. 结束，本次不添加`);
    const choice = await choiceValue(prompt, "选择监测方式", ["0", "1", "2", "3"], existing.some(isCarrier) ? "0" : "1", { line });
    if (choice === "0") return [];
    if (choice === "1" && existing.some(isCarrier)) { line("已有三网探针；如需更换目标，请先删除原有三网探针或重新配置。"); continue; }
    if (choice === "1" && existing.length + 3 > maxProbes) { line(`三网需要 3 个探针名额，当前只剩 ${maxProbes - existing.length} 个。`); continue; }
    if (choice === "2" && !nodes.length) { line("没有其他节点可选，请先添加节点。"); continue; }
    if (choice === "3" && sites >= maxPublicSites) { line(`公网网址最多 ${maxPublicSites} 个，请先删除不需要的。`); continue; }
    if (choice !== "1" && existing.length >= maxProbes) { line(`已达到 ${maxProbes} 个上限，请先删除探针。`); continue; }
    const probes = [];
    try {
      if (choice === "1") {
        line("填写三个运营商的参考目标；面板上只按运营商显示。");
        const values = await promptFields([
          ...[["ct", "电信"], ["cu", "联通"], ["cm", "移动"]].map(([key, label]) =>
            [key, (_values, previous) => targetValue(prompt, `${label}参考目标的 IP 或主机名`, line, previous)]),
          ["port", (_values, previous) => integerValue(prompt, "三个目标共用的 TCP 端口", 1, 65535, previous ?? 80, { line })],
        ], { line });
        const result = createCarrierProbes({ targets: values, port: values.port, prefix: nextProbeName("carrier", existing, ["_ct", "_cu", "_cm"]) });
        line("三网探针配置完成，共 3 个。");
        return result;
      }
      const create = choice === "2"
        ? () => nodeLinkProbe(prompt, [...existing, ...probes], nodes, line)
        : () => publicSiteProbe(prompt, [...existing, ...probes], line);
      const room = () => choice === "2"
        ? existing.length + probes.length < maxProbes
        : existing.length + probes.length < maxProbes && sites + probes.length < maxPublicSites;
      do {
        probes.push(await create());
        line(`已添加：${describeProbe(probes.at(-1))}`);
      } while (room() && await prompt.yes(`已添加 ${probes.length} 个，继续添加`, false));
      return probes;
    } catch (error) {
      if (error instanceof PromptClosed || !(error instanceof PromptCancelled)) throw error;
      if (probes.length) { line(`已取消继续添加，保留本次已完成的 ${probes.length} 个探针。`); return probes; }
      if (error instanceof PromptBack) { line("已返回监测方式选择。"); continue; }
      throw error;
    }
  }
}

export async function editObserverEntries(prompt, { label, entries, create, limit, line = console.log, fallback = "1" }) {
  line("  1. 保留\n  2. 追加\n  3. 重新配置\n  4. 删除指定项");
  const action = await inputValue(prompt, `${label}操作`, {
    hint: `可选 1–4；已配置 ${entries.length} 个，最多 ${limit} 个`, fallback, line,
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
    try {
      const additions = await create({ existing });
      // Choosing no additions must not silently erase the original list.
      if (!additions.length) return entries;
      return mergeObserverEntries(existing, additions, { label, limit });
    } catch (error) {
      if (error instanceof PromptClosed || !(error instanceof PromptCancelled)) throw error;
      line("已取消本次修改，原有探针保留。");
      return entries;
    }
  }
  entries.forEach((entry, index) => line(`  ${index + 1}. ${entry.label || entry.name} (${entry.name})`));
  const selected = await inputValue(prompt, `删除${label}的编号`, {
    hint: `1–${entries.length}，英文逗号分隔；0 全部删除；回车全部保留`, line,
    parse: (value) => value === "0" ? entries.map((_entry, index) => index) : selectedIndices(value, entries.length),
  });
  return entries.filter((_entry, index) => !selected.includes(index));
}

/**
 * Panel display text lives in the Agent config; the Worker catalog adopts it from the next report.
 * Each prompt defaults to the current value, so pressing Enter keeps it.
 */
export async function promptNodeDisplay(prompt, node, { line = console.log } = {}) {
  if (!(await prompt.yes("修改面板显示名 / 用途 / 地区", false))) return false;
  node.display_name = await displayValue(prompt, "面板显示名", node.display_name || node.id, { line });
  node.role = await displayValue(prompt, "用途（如网站、备份、中转）", node.role || "VPS", { line });
  node.region = await displayValue(prompt, "国家 / 城市", node.region || "unspecified", { line });
  return true;
}

export function printObserverSummary(config, line = console.log) {
  line(`\n监测配置 · ${config.node.display_name || config.node.id} (${config.node.id})`);
  line(`  面板显示：${[config.node.display_name || config.node.id, config.node.role, config.node.region].filter(Boolean).join(" · ")}`);
  line("  主机资源：CPU、内存、磁盘和网卡流量");
  line(`  systemd 服务：${config.services.length ? config.services.map((service) => service.name).join("、") : "未配置"}`);
  line(`  网络探针：${config.probes.length ? `${config.probes.length} 个` : "未配置（没有三网延迟/丢包检测）"}`);
  for (const probe of config.probes) line(`    ${describeProbe(probe)}`);
}
