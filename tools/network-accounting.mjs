import { createHash } from "node:crypto";
import { InputError, choiceValue, inputValue, integerValue } from "./prompts.mjs";

export const interfacePattern = /^(?!lo$|\.{1,2}$)[A-Za-z0-9_.:-]{1,15}$/;
export function normalizeAccounting(config = {}) {
 const names = config.network_interfaces ?? [];
 if (!Array.isArray(names) || names.length > 16 || names.some(name => typeof name !== "string" || !interfacePattern.test(name)) || new Set(names).size !== names.length) {
  throw new InputError("网卡须为最多 16 个不重复的实际接口名称，不能使用 lo");
 }
 const cycle = config.traffic_cycle ?? {};
 if (!cycle || typeof cycle !== "object" || Array.isArray(cycle)) throw new InputError("周期流量配置须为对象");
 const enabled = cycle.enabled ?? false;
 const day = cycle.reset_day ?? 1;
 const zone = cycle.time_zone ?? "UTC";
 if (typeof enabled !== "boolean") throw new InputError("周期流量 enabled 须为 true 或 false");
 if (!Number.isInteger(day) || day < 1 || day > 31) throw new InputError("流量重置日须为 1–31 的整数");
 if (!["UTC", "Asia/Shanghai"].includes(zone)) throw new InputError("流量时区只能是 UTC 或 Asia/Shanghai");
 return {network_interfaces:[...names],traffic_cycle:{enabled,reset_day:day,time_zone:zone}};
}

export function serializeAgentConfig(config) {
 const staged = {...config,...normalizeAccounting(config)};
 delete staged.nftables_counters;
 return `${JSON.stringify(staged, null, 2)}\n`;
}
export function configFingerprint(text) { return createHash("sha256").update(text).digest("hex"); }

export const networkInventoryCommand = "cat /proc/net/dev && printf '\\nLUME_ROUTES4\\n' && cat /proc/net/route && printf '\\nLUME_ROUTES6\\n' && cat /proc/net/ipv6_route";
export function parseNetworkInventory(raw) {
 const [dev, rest] = String(raw).split("\nLUME_ROUTES4\n");
 if (rest === undefined) throw new Error("网卡读取响应不完整");
 const [v4, v6] = rest.split("\nLUME_ROUTES6\n");
 if (v6 === undefined) throw new Error("路由读取响应不完整");
 const names = dev.split(/\r?\n/).flatMap(line => {
  const delimiter = line.lastIndexOf(":");
  const name = line.slice(0,delimiter).trim();
  return delimiter >= 0 && interfacePattern.test(name) && line.slice(delimiter+1).trim().split(/\s+/).length === 16 ? [name] : [];
 }).sort();
 if (!names.length) throw new Error("未发现可统计网卡");
 const defaults = new Set();
 for (const [family, routes] of [v4,v6].entries()) {
  let best = Infinity, candidates = new Set();
  for (const line of routes.split(/\r?\n/)) {
   const f = line.trim().split(/\s+/);
   if (family === 0 ? f.length < 8 || f[1] !== "00000000" || f[7] !== "00000000" : f.length < 10 || f[0] !== "0".repeat(32) || f[1] !== "00") continue;
   const name = f[family === 0 ? 0 : 9];
   const metric = Number.parseInt(f[family === 0 ? 6 : 5],family === 0 ? 10 : 16);
   const flags = Number.parseInt(f[family === 0 ? 3 : 8],16);
   if (!names.includes(name) || !Number.isSafeInteger(metric) || !(flags & 1) || (flags & 0x200)) continue;
   if (metric < best) { best=metric; candidates=new Set(); }
   if (metric === best) candidates.add(name);
  }
  for (const name of candidates) defaults.add(name);
 }
 return {interfaces:[...new Set(names)],defaults:[...defaults].sort()};
}

export async function promptAccounting(prompt, config, {discover, line = console.log} = {}) {
 const current = normalizeAccounting(config);
 const inventory = discover ? await discover() : null;
 line("流量统计网卡：");
 if (current.network_interfaces.length) line(`  0. 保留当前：${current.network_interfaces.join("、")}`);
 line(`  1. 自动选择默认路由网卡${inventory?.defaults.length === 1 ? `（${inventory.defaults[0]}）` : ""}`);
 if (inventory) line("  2. 从本机网卡中选择");
 else line("  尚未读取到远端网卡；自动模式将在 Agent 启动时识别。指定网卡需先配置可用的 SSH 目标。");
 const choices = [...(current.network_interfaces.length ? ["0"] : []),"1",...(inventory ? ["2"] : [])];
 const fallback = current.network_interfaces.length ? "0" : inventory && inventory.defaults.length !== 1 ? "2" : "1";
 const mode = await inputValue(prompt,"选择统计方式",{fallback,hint:`可选：${choices.join(" / ")}`,line,parse:value=>{
  if (!choices.includes(value)) throw new InputError(`只能选择 ${choices.join(" / ")}`);
  if (value === "1" && inventory && inventory.defaults.length !== 1) throw new InputError("无法确定单一默认路由网卡，请选 2 指定统计范围");
  return value;
 }});
 let names = mode === "0" ? current.network_interfaces : [];
 if (mode === "2") {
  inventory.interfaces.forEach((name,index)=>line(`  ${index+1}. ${name}${inventory.defaults.includes(name) ? "（默认路由）" : ""}`));
  const selected = current.network_interfaces.length ? current.network_interfaces : inventory.defaults.slice(0,1);
  names = await inputValue(prompt,"选择网卡编号",{hint:`1–${inventory.interfaces.length}，英文逗号分隔，最多 16 项且不能重复`,fallback:selected.filter(name=>inventory.interfaces.includes(name)).map(name=>inventory.interfaces.indexOf(name)+1).join(","),line,parse:value=>{
   const values=value.split(",").map(part=>part.trim());
   if (values.length>16 || values.some(part=>!/^\d+$/.test(part) || Number(part)<1 || Number(part)>inventory.interfaces.length) || new Set(values.map(Number)).size!==values.length) throw new InputError(`请输入 1–${inventory.interfaces.length} 的不重复编号，最多 16 项`);
   return values.map(number=>inventory.interfaces[Number(number)-1]);
  }});
  line(`  统计范围：${names.join("、")}。所选接口会相加；请避免同时选择桥接或隧道及其底层接口。`);
 }
 const enabled = await prompt.yes("启用周期流量统计",current.traffic_cycle.enabled);
 let {reset_day:day,time_zone:zone} = current.traffic_cycle;
 if (enabled) {
  day = await integerValue(prompt,"每月流量重置日",1,31,day,{line});
  line("流量统计时区：1. UTC / 2. 北京时间（Asia/Shanghai）");
  zone = await choiceValue(prompt,"选择时区",["1","2"],zone === "UTC" ? "1" : "2",{line}) === "1" ? "UTC" : "Asia/Shanghai";
  line("  在所选时区的重置日 00:00 开始新周期；当月没有该日时使用月末。首次启用从当前计数起算。");
 }
 return {network_interfaces:names,traffic_cycle:{enabled,reset_day:day,time_zone:zone}};
}

export function printAccountingSummary(config,line=console.log) {
 const value=normalizeAccounting(config);
 line(`  流量网卡：${value.network_interfaces.length ? value.network_interfaces.join("、") : "自动（单一默认路由网卡）"}`);
 line(`  周期流量：${value.traffic_cycle.enabled ? `每月 ${value.traffic_cycle.reset_day} 日 00:00 重置 · ${value.traffic_cycle.time_zone}` : "未启用"}`);
}
export function matchesAppliedReport(node,{fingerprint,since=0,version}={}) {
 return Boolean(node && Number.isInteger(node.last_report_at) && node.last_report_at>0 && node.last_report_at>=since && Number.isInteger(node.generated_at) && node.generated_at>0 && node.generated_at>=since &&
  /^[a-f0-9]{64}$/.test(fingerprint ?? "") && node.config_fingerprint===fingerprint && (!version || node.agent_version===version));
}
export function configurationStatus(local,node,expected,{available=true,supportsFingerprint=true}={}) {
 if (!available) return "配置无法核验（后端不可达）";
 if (/^[a-f0-9]{64}$/.test(expected ?? "") && node?.config_fingerprint === expected && (!local.deployedAfter || Number(node.generated_at)>=local.deployedAfter)) return "配置已生效";
 if (local.applyError) return "上次应用失败，待重试";
 if (local.pendingConfirmation) return "配置已写入，待启动确认";
 if (local.pendingApply) return "配置待部署";
 if (!supportsFingerprint) return "配置待核验（Worker 尚不支持配置核验）";
 if (!node?.last_report_at) return "配置待核验（尚未收到 Agent 上报）";
 if (!node?.config_fingerprint) return "配置待核验（Agent 未上报配置摘要）";
 return "本地与 Agent 配置不一致";
}
