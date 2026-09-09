#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { Writable } from "node:stream";
import { applyPending, keyProof, parseJsonc, restorePeerProbes, validateImportedConfig, verifyKeyInventory, workerOrigin } from "./management.mjs";

const toolFile = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(toolFile), "..");
const workerDir = join(repoRoot, "worker");
const agentDir = join(repoRoot, "agent");
const deployDir = join(repoRoot, "deploy");
const privateDir = join(repoRoot, ".lume");
const privateDirName = basename(privateDir);
const statePath = join(privateDir, "state.json");
const wranglerConfigPath = join(workerDir, "wrangler.jsonc");
const wranglerBin = join(workerDir, "node_modules", "wrangler", "bin", "wrangler.js");
const releaseRepository = process.env.LUME_RELEASE_REPOSITORY || "MostlyCodex/lume-monitor";
const maxDownloadBytes = 64 * 1024 * 1024;
const cacheDir = join(privateDir, "cache");

class DownloadUnavailableError extends Error {}

function line(message = "") {
  process.stdout.write(`${message}\n`);
}

function fail(message) {
  throw new Error(message);
}

function stripAnsi(value) {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
}

function randomSecret() {
  return randomBytes(32).toString("hex");
}

function exists(path) {
  return lstat(path).then(() => true, () => false);
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} 格式无效`);
}

export function parseFlags(args) {
  const flags = new Map();
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    if (typeof item !== "string" || !item.startsWith("--")) {
      positional.push(item);
      continue;
    }
    const separator = item.indexOf("=");
    if (separator > 2) {
      flags.set(item.slice(2, separator), item.slice(separator + 1));
      continue;
    }
    const name = item.slice(2);
    const next = args[index + 1];
    if (next === undefined || next.startsWith("--")) {
      flags.set(name, true);
      continue;
    }
    flags.set(name, next);
    index += 1;
  }
  return { flags, positional };
}

export function validateWorkerName(value) {
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(value);
}

export function validateDatabaseName(value) {
  return /^[a-z0-9][a-z0-9_-]{0,62}$/.test(value);
}

export function validateNodeId(value) {
  return /^[a-z0-9][a-z0-9_-]{0,31}$/.test(value);
}

export function validateSshTarget(value) {
  return /^(?!-)[A-Za-z0-9_.@:[\]-]{1,255}$/.test(value);
}

export function parseD1List(raw) {
  const clean = stripAnsi(raw).trim();
  const first = clean.indexOf("[");
  const last = clean.lastIndexOf("]");
  if (first < 0 || last < first) fail("无法解析 Wrangler 返回的 D1 列表");
  const parsed = JSON.parse(clean.slice(first, last + 1));
  if (!Array.isArray(parsed)) fail("Wrangler 返回的 D1 列表格式无效");
  return parsed.map((item) => ({
    name: item.name,
    id: item.uuid || item.id || item.database_id,
  })).filter((item) => typeof item.name === "string" && typeof item.id === "string");
}

export function parseReleaseChecksum(manifest, asset) {
  for (const rawLine of manifest.split(/\r?\n/)) {
    const match = rawLine.trim().match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
    if (match && match[2] === asset) return match[1].toLowerCase();
  }
  fail(`SHA256SUMS 中没有 ${asset}`);
}

export function createWranglerConfig({ workerName, databaseName, databaseId, dashboardUrl, botUsername, version }) {
  if (!validateWorkerName(workerName)) fail("Worker 名称格式无效");
  if (!validateDatabaseName(databaseName) || !databaseId) fail("D1 名称或 ID 无效");
  return {
    $schema: "node_modules/wrangler/config-schema.json",
    name: workerName,
    main: "src/index.ts",
    compatibility_date: "2026-08-19",
    workers_dev: true,
    preview_urls: false,
    observability: { enabled: false },
    vars: {
      APP_VERSION: version,
      REPORT_MAX_AGE_SECONDS: "300",
      TELEGRAM_BOT_USERNAME: botUsername || "lume_monitor_bot",
      DASHBOARD_BASE_URL: dashboardUrl || "https://setup-pending.invalid",
    },
    assets: {
      directory: "./public",
      binding: "ASSETS",
      run_worker_first: true,
    },
    d1_databases: [{
      binding: "DB",
      database_name: databaseName,
      database_id: databaseId,
      migrations_dir: "migrations",
    }],
    triggers: { crons: ["* * * * *", "0 1 * * *"] },
  };
}

export function createAgentConfig({
  id,
  displayName,
  shortMark,
  role,
  region,
  displayOrder,
  endpoint,
  secret,
  services = [],
  probes = [],
  nftablesCounters = [],
}) {
  if (!validateNodeId(id)) fail("节点 ID 必须匹配 [a-z0-9][a-z0-9_-]{0,31}");
  if (typeof secret !== "string" || secret.length < 32) fail("节点密钥无效");
  const mark = (shortMark || id.replace(/[-_]/g, "").slice(0, 3)).toUpperCase();
  if (!/^[A-Z0-9]{1,4}$/.test(mark)) fail("节点短标记只能包含 1–4 个字母或数字");
  for (const [label, value] of [["显示名", displayName || id], ["用途", role || "VPS"], ["地区", region || "unspecified"]]) {
    if (typeof value !== "string" || value.length < 1 || value.length > 80 || /[\r\n\t]/.test(value)) fail(`${label} 必须是 1–80 个普通字符`);
  }
  return {
    node: {
      id,
      display_name: displayName || id,
      short_mark: mark,
      role: role || "VPS",
      group: "default",
      region: region || "unspecified",
      stale_seconds: 180,
      display_order: displayOrder || 100,
      color: "green",
      offline_severity: "P1",
      ip_change_severity: "P2",
    },
    endpoint: `${endpoint.replace(/\/$/, "")}/api/v1/report`,
    secret,
    report_interval_seconds: 60,
    probe_interval_seconds: 60,
    services,
    probes,
    nftables_counters: nftablesCounters,
    spool_path: "/var/lib/vpsmon/pending.json",
  };
}

async function ensurePrivateDirectory() {
  if (await exists(privateDir)) {
    const info = await lstat(privateDir);
    if (!info.isDirectory() || info.isSymbolicLink()) fail(`${privateDir} 必须是普通目录，不能是符号链接`);
  } else {
    await mkdir(privateDir, { mode: 0o700 });
  }
  await chmod(privateDir, 0o700).catch(() => {});
}

async function writePrivateJson(path, value) {
  await ensurePrivateDirectory();
  const parent = dirname(path);
  if (parent !== privateDir) {
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const info = await lstat(parent);
    if (!info.isDirectory() || info.isSymbolicLink()) fail(`${parent} 不是安全目录`);
    await chmod(parent, 0o700).catch(() => {});
  }
  const temporary = join(parent, `.${basename(path)}.${randomBytes(6).toString("hex")}.tmp`);
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await chmod(temporary, 0o600).catch(() => {});
  await rename(temporary, path);
  await chmod(path, 0o600).catch(() => {});
}

async function loadState(required = true) {
  if (!(await exists(statePath))) {
    if (required) fail("未找到本地管理状态。已有线上部署请运行 npm run setup:adopt；首次部署请运行 npm run setup。");
    return null;
  }
  const info = await lstat(statePath);
  if (!info.isFile() || info.isSymbolicLink()) fail(`${privateDirName}/state.json 必须是普通文件，不能是符号链接`);
  const state = JSON.parse(await readFile(statePath, "utf8"));
  assertPlainObject(state, "部署状态");
  assertPlainObject(state.nodeKeys, "nodeKeys");
  assertPlainObject(state.nodes, "nodes");
  for (const [id, secret] of Object.entries(state.nodeKeys)) {
    if (!validateNodeId(id) || typeof secret !== "string" || secret.length < 32 || secret.length > 256) fail("部署状态包含无效节点密钥");
  }
  return state;
}

async function readVersion() {
  const packageJson = JSON.parse(await readFile(join(workerDir, "package.json"), "utf8"));
  return packageJson.version;
}

function commandProbe(command, args = ["--version"]) {
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: "utf8", windowsHide: true });
  return { found: !result.error || result.error.code !== "ENOENT", status: result.status, output: `${result.stdout || ""}${result.stderr || ""}`.trim() };
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const capture = Boolean(options.capture);
    const child = spawn(command, args, {
      cwd: options.cwd || repoRoot,
      env: options.env || process.env,
      stdio: options.interactive ? "inherit" : [options.input === undefined ? "inherit" : "pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    if (!options.interactive) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        if (!capture || options.echo) process.stdout.write(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
        if (!capture || options.echo) process.stderr.write(chunk);
      });
      if (options.input !== undefined) child.stdin.end(`${options.input}\n`);
    }
    child.once("error", rejectPromise);
    child.once("exit", (code) => {
      const result = { code: code ?? 1, stdout, stderr };
      if (result.code !== 0 && !options.allowFailure) {
        rejectPromise(new Error(`${basename(command)} 执行失败（退出码 ${result.code}）`));
      } else {
        resolvePromise(result);
      }
    });
  });
}

function wrangler(args, options = {}) {
  return run(process.execPath, [wranglerBin, ...args], { cwd: workerDir, ...options });
}

async function secretPut(name, value) {
  line(`  写入 Worker Secret：${name}`);
  await wrangler(["secret", "put", name, "--config", wranglerConfigPath], { input: value });
}

/**
 * `wrangler secret bulk` applies up to 100 secrets in a single request, and a
 * null value deletes one. Every `secret put` creates its own Worker version,
 * so writing four secrets used to mean four deploys during a fresh setup.
 */
async function secretBulk(secrets) {
  const names = Object.keys(secrets);
  if (names.length === 0) return;
  line(`  写入 Worker Secret（单次提交 ${names.length} 项）：${names.join("、")}`);
  await wrangler(["secret", "bulk", "--config", wranglerConfigPath], { input: JSON.stringify(secrets) });
}

async function publishNodeKeys(state) {
  await assertServerInventory(state);
  await secretBulk({ NODE_KEYS: JSON.stringify(state.nodeKeys) });
  state.keyInventory = { keys: Object.entries(state.nodeKeys).map(([node_id, secret]) => ({ node_id, proof: keyProof(node_id, secret) })), revoked_node_ids: state.keyInventory?.revoked_node_ids || [] };
  await writePrivateJson(statePath, state);
}

async function publishRevokedNodeIds(state) {
  await assertServerInventory(state);
  const revoked = Array.isArray(state.revokedNodeIds) ? state.revokedNodeIds : [];
  // An empty array rather than a delete: removing a secret that was never set
  // is an error, and an empty list is what the Worker already treats as none.
  await writePrivateJson(statePath, state);
  await secretBulk({ REVOKED_NODE_IDS: JSON.stringify(revoked) });
  if (state.keyInventory) state.keyInventory.revoked_node_ids = [...revoked];
  await writePrivateJson(statePath, state);
}

function inventorySignature(inventory) {
  return JSON.stringify({ keys: [...inventory.keys].sort((a, b) => a.node_id.localeCompare(b.node_id)), revoked_node_ids: [...inventory.revoked_node_ids].sort() });
}

async function getServerInventory(state) {
  const result = await adminFetch(state, "/api/v1/admin/key-inventory");
  if (!result.ok || !Array.isArray(result.body?.keys)) fail(`无法读取后端管理清单（HTTP ${result.status}）。先更新 Worker：npm run deploy，然后重试。`);
  return result.body;
}

async function assertServerInventory(state) {
  const inventory = await getServerInventory(state);
  if (!state.keyInventory) {
    verifyKeyInventory(state.nodeKeys, inventory);
    state.keyInventory = inventory;
    state.revokedNodeIds = inventory.revoked_node_ids;
    await writePrivateJson(statePath, state);
  } else if (inventorySignature(state.keyInventory) !== inventorySignature(inventory)) {
    // A previous request may have succeeded even when its response was lost.
    const intended = { keys: Object.entries(state.nodeKeys).map(([node_id, secret]) => ({ node_id, proof: keyProof(node_id, secret) })), revoked_node_ids: state.revokedNodeIds || [] };
    if (inventorySignature(intended) !== inventorySignature(inventory)) fail("线上密钥清单已被其他操作修改，停止覆盖。请运行 npm run setup:adopt 核对并接管最新状态。");
    state.keyInventory = inventory;
    await writePrivateJson(statePath, state);
  }
}

async function readNodeConfiguration(prompt, id, defaultTarget = "", rebuildOrigin = "") {
  const source = await prompt.text(`${id} 配置来源：1 SSH 读取 / 2 本地配置文件${rebuildOrigin ? " / 3 重新配置" : ""}`, "1");
  if (source === "3" && rebuildOrigin) {
    const displayName = await prompt.text("节点显示名", id);
    const role = await prompt.text("用途", "VPS");
    const region = await prompt.text("地区", "unspecified");
    const services = parseServices(await prompt.text("systemd 服务（逗号分隔，可留空）"));
    const observers = await promptOptionalObservers(prompt);
    const target = await prompt.text("SSH 别名", defaultTarget || id);
    return { target, config: createAgentConfig({ id, displayName, role, region, endpoint: rebuildOrigin, secret: randomSecret(), services, probes: observers.probes, nftablesCounters: observers.nftablesCounters }) };
  }
  if (source === "2") {
    const path = await prompt.text("配置文件路径（内容不会打印）");
    return { config: JSON.parse((await readFile(resolve(path), "utf8")).replace(/^\uFEFF/, "")), target: await prompt.text("SSH 别名（用于后续管理）", defaultTarget || id) };
  }
  if (source !== "1") fail("请选择 1 或 2");
  const target = await prompt.text(`${id} 的 SSH 别名`, defaultTarget || id);
  if (!validateSshTarget(target)) fail("SSH 别名无效");
  line("只读获取配置；需要 root 或免密码 sudo。若不可用，可重试并选择本地配置文件。");
  const response = await run("ssh", [target, 'if [ "$(id -u)" -eq 0 ]; then cat /etc/vpsmon/config.json; else sudo -n cat /etc/vpsmon/config.json; fi'], { capture: true });
  return { config: JSON.parse(response.stdout), target };
}

async function adoptDeployment(prompt) {
  if (!(await exists(wranglerConfigPath))) fail("请先把现有 worker/wrangler.jsonc 放入本目录，再运行 npm run setup:adopt。");
  const oldState = await loadState(false);
  if (oldState && !(await prompt.yes("重新核对线上部署并替换本地管理记录（自动备份旧记录）", false))) return;
  const config = parseJsonc(await readFile(wranglerConfigPath, "utf8"));
  const binding = config.d1_databases?.find((entry) => entry.binding === "DB");
  if (!validateWorkerName(config.name) || !binding?.database_id || !binding?.database_name) fail("现有 Wrangler 配置缺少 Worker 名称或 DB 绑定");
  const origin = workerOrigin(await prompt.text("现有 Worker 的 HTTPS 根地址", oldState?.workerUrl || config.vars?.DASHBOARD_BASE_URL || ""));
  const adminToken = await prompt.secret("现有 ADMIN_TOKEN");
  if (!adminToken) fail("ADMIN_TOKEN 不能为空");
  const state = { schemaVersion: 1, stage: "ready", workerName: config.name, databaseName: binding.database_name, databaseId: binding.database_id, workerUrl: origin, adminToken, nodeKeys: {}, nodes: {}, retiredNodes: {}, telegram: null };
  let databaseChecked = false;
  let inventoryResponse = await adminFetch(state, "/api/v1/admin/key-inventory");
  if (inventoryResponse.status === 404 || (inventoryResponse.ok && !inventoryResponse.body?.keys)) {
    line("现有 Worker 尚无接管接口。需要先应用现有 D1 的待执行迁移，再部署当前 Worker 代码；保留数据库、变量和 Secrets。");
    if (!(await prompt.yes("更新现有 Worker 管理接口", true))) return;
    await ensureCloudflareLogin();
    await applyDatabaseMigrations(state);
    databaseChecked = true;
    await wrangler(["deploy", "--keep-vars", "--config", wranglerConfigPath]);
    inventoryResponse = await adminFetch(state, "/api/v1/admin/key-inventory");
  }
  if (!inventoryResponse.ok || !Array.isArray(inventoryResponse.body?.keys)) fail(`接管鉴权失败（HTTP ${inventoryResponse.status}），未修改本地管理状态`);
  const inventory = inventoryResponse.body;
  // A previous attempt may have updated the Worker without updating D1.
  if (!databaseChecked) {
    await ensureCloudflareLogin();
    await applyDatabaseMigrations(state);
  }
  const remoteNodes = await adminNodeList(state);
  for (const node of remoteNodes.filter((entry) => entry.retired)) state.retiredNodes[node.node_id] = { retiredAt: node.retired_at, sshTarget: oldState?.retiredNodes?.[node.node_id]?.sshTarget || "" };
  const imported = [];
  line(`线上共有 ${inventory.keys.length} 份节点密钥，将逐一核对，包括尚未上报的节点。`);
  for (const entry of inventory.keys) {
    if (!validateNodeId(entry.node_id)) fail("线上清单包含无效节点 ID");
    const { config: nodeConfig, target } = await readNodeConfiguration(prompt, entry.node_id, oldState?.nodes?.[entry.node_id]?.sshTarget);
    if (!validateSshTarget(target)) fail("SSH 别名无效");
    validateImportedConfig(nodeConfig, entry.node_id, origin);
    state.nodeKeys[entry.node_id] = nodeConfig.secret;
    const retired = Boolean(state.retiredNodes[entry.node_id]);
    const nodePath = join(privateDir, retired ? "retired" : "nodes", entry.node_id, "config.json");
    (retired ? state.retiredNodes : state.nodes)[entry.node_id] = { ...(state.retiredNodes[entry.node_id] || {}), configPath: nodePath, sshTarget: target, installed: true };
    imported.push({ path: nodePath, config: nodeConfig });
  }
  verifyKeyInventory(state.nodeKeys, inventory);
  // Recheck after user input: no stale snapshots during a long adoption session.
  if (inventorySignature(inventory) !== inventorySignature(await getServerInventory(state))) fail("接管期间线上密钥发生变化，请重新接管");
  state.keyInventory = inventory;
  state.revokedNodeIds = inventory.revoked_node_ids;
  if (oldState) await writePrivateJson(join(privateDir, "backups", `state-${Date.now()}.json`), oldState);
  for (const entry of imported) await writePrivateJson(entry.path, entry.config);
  await writePrivateJson(statePath, state);
  line("✓ 已核对全部现有密钥并建立本地管理状态。现在可以新增、配置、下线或恢复节点。");
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function adminFetch(state, path_, { method = "GET", timeoutMs = 15_000 } = {}) {
  if (!state.workerUrl) fail("尚未记录 Worker 地址，请先重新运行 npm run setup");
  const response = await fetch(`${state.workerUrl}${path_}`, {
    method,
    headers: { Authorization: `Bearer ${state.adminToken}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, body };
}

/**
 * The Worker learns its own public origin from this authenticated call, which
 * is what lets a fresh setup deploy exactly once instead of deploying, reading
 * back the workers.dev hostname and deploying again.
 */
async function registerDashboardOrigin(state) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await sleep(2000);
    try {
      const result = await adminFetch(state, "/api/v1/admin/dashboard-origin", { method: "POST" });
      if (result.ok && result.body?.dashboard_origin) {
        line(`✓ 已记录面板地址：${result.body.dashboard_origin}`);
        return result.body.dashboard_origin;
      }
    } catch {
      // A just-deployed Worker can need a moment before it answers.
    }
  }
  line("! 未能记录面板地址；Worker 将继续使用配置文件中的 DASHBOARD_BASE_URL。");
  return null;
}

async function adminNodeList(state) {
  const result = await adminFetch(state, "/api/v1/admin/nodes");
  if (!result.ok) {
    const hint = result.status === 401
      ? "请核对 Worker 地址和 ADMIN_TOKEN。"
      : result.status >= 500
        ? "请检查 Worker 的 D1 绑定、数据库迁移和运行日志。"
        : "请检查 Worker 地址和访问策略。";
    fail(`无法读取节点目录（HTTP ${result.status}）。${hint}`);
  }
  if (!Array.isArray(result.body?.nodes)) fail(`节点目录响应格式无效（HTTP ${result.status}）。请检查 Worker 地址与部署版本。`);
  return result.body.nodes;
}

async function waitForFirstReport(state, id, timeoutSeconds = 90, since = 0) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    try {
      const nodes = await adminNodeList(state);
      const node = nodes?.find((entry) => entry.node_id === id);
      if (node && Number(node.last_report_at) >= since && node.last_report_at !== null) return node;
    } catch {
      // Keep polling; the node is what is being waited on, not the network.
    }
    await sleep(3000);
  }
  return null;
}

function makePrompter() {
  let muted = false;
  const output = new Writable({ write(chunk, encoding, done) { if (!muted) process.stdout.write(chunk, encoding); done(); } });
  const interface_ = createInterface({ input: process.stdin, output, terminal: Boolean(process.stdin.isTTY) });
  return {
    async secret(question) {
      process.stdout.write(`${question}（输入不显示）: `);
      muted = true;
      try { return (await interface_.question("")).trim(); }
      finally { muted = false; line(); }
    },
    async text(question, fallback = "") {
      const suffix = fallback ? ` [${fallback}]` : "";
      const value = (await interface_.question(`${question}${suffix}: `)).trim();
      return value || fallback;
    },
    async yes(question, fallback = false) {
      const hint = fallback ? "Y/n" : "y/N";
      const value = (await interface_.question(`${question} [${hint}]: `)).trim().toLowerCase();
      if (!value) return fallback;
      return value === "y" || value === "yes" || value === "是";
    },
    close() { interface_.close(); },
  };
}

async function doctor({ quiet = false } = {}) {
  const checks = [];
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  checks.push({ name: "Node.js 22+", ok: nodeMajor >= 22, detail: `v${process.versions.node}` });
  checks.push({ name: "Worker 依赖", ok: await exists(wranglerBin), detail: await exists(wranglerBin) ? "已安装" : "请先在 worker 目录运行 npm ci" });
  for (const [name, command, args] of [
    ["Git", "git", ["--version"]],
    ["SSH", "ssh", ["-V"]],
    ["SCP", "scp", []],
  ]) {
    const result = commandProbe(command, args);
    checks.push({ name, ok: result.found, detail: result.found ? (result.output.split(/\r?\n/)[0] || "已找到") : "未找到" });
  }
  if (!quiet) {
    line("Lume 环境检查");
    for (const check of checks) line(`${check.ok ? "✓" : "✗"} ${check.name.padEnd(14)} ${check.detail}`);
    line("");
    line((await exists(statePath)) ? `本地管理状态：${statePath}` : "未找到本地管理记录（不代表线上未部署）");
  }
  return checks.every((check) => check.ok);
}

async function ensureCloudflareLogin() {
  const whoami = await wrangler(["whoami", "--json"], { capture: true, allowFailure: true });
  if (whoami.code === 0) return;
  line("Cloudflare 尚未登录，将打开 Wrangler 登录流程。");
  await wrangler(["login"], { interactive: true });
  const verified = await wrangler(["whoami", "--json"], { capture: true, allowFailure: true });
  if (verified.code !== 0) fail("Cloudflare 登录未完成");
}

async function applyDatabaseMigrations(state) {
  line("检查并应用现有 D1 的待执行迁移…");
  await wrangler(["d1", "migrations", "apply", state.databaseName, "--remote", "--config", wranglerConfigPath]);
}

async function findOrCreateDatabase(state, prompt) {
  const list = await wrangler(["d1", "list", "--json"], { capture: true });
  let databases = parseD1List(list.stdout);
  let database = databases.find((item) => item.name === state.databaseName);
  if (database && !state.databaseId) {
    const useExisting = await prompt.yes(`账号中已有 D1 “${state.databaseName}”，是否使用它`, false);
    if (!useExisting) fail("请重新运行 setup 并换一个 D1 名称");
  }
  if (!database) {
    line(`创建 D1：${state.databaseName}`);
    await wrangler(["d1", "create", state.databaseName]);
    for (let attempt = 0; attempt < 3 && !database; attempt += 1) {
      if (attempt > 0) await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
      const refreshed = await wrangler(["d1", "list", "--json"], { capture: true });
      databases = parseD1List(refreshed.stdout);
      database = databases.find((item) => item.name === state.databaseName);
    }
  }
  if (!database) fail("D1 已创建但未能读取数据库 ID，请稍后重新运行 setup");
  state.databaseId = database.id;
  await writePrivateJson(statePath, state);
  return database;
}

async function writeWorkerConfig(state) {
  const version = await readVersion();
  const config = createWranglerConfig({
    workerName: state.workerName,
    databaseName: state.databaseName,
    databaseId: state.databaseId,
    dashboardUrl: state.workerUrl,
    botUsername: state.telegram?.username,
    version,
  });
  await writeFile(wranglerConfigPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function extractWorkerUrl(output) {
  const matches = stripAnsi(output).match(/https:\/\/[a-z0-9.-]+\.workers\.dev\/?/gi) || [];
  return matches.length ? matches[matches.length - 1].replace(/\/$/, "") : "";
}

async function verifyHealth(workerUrl) {
  try {
    const response = await fetch(`${workerUrl}/healthz`, { signal: AbortSignal.timeout(10_000) });
    const body = await response.json();
    if (!response.ok || body.ok !== true) fail("健康检查返回异常");
    line(`✓ Worker 健康检查通过：${workerUrl}/healthz`);
    return true;
  } catch (error) {
    line(`! 暂时无法从本机访问健康检查：${error.message}`);
    return false;
  }
}

async function configureTelegram(state) {
  const response = await fetch(`${state.workerUrl}/api/v1/admin/configure-telegram-webhook`, {
    method: "POST",
    headers: { Authorization: `Bearer ${state.adminToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) fail(`Telegram Webhook 配置失败（HTTP ${response.status}）`);
  state.telegram.configured = true;
  await writePrivateJson(statePath, state);
}

async function setup(prompt, assumeYes) {
  if (!(await doctor({ quiet: true }))) {
    await doctor();
    fail("环境检查未通过，请先修复上面的项目");
  }
  let state = await loadState(false);
  if (!state) {
    if (await exists(wranglerConfigPath)) {
      line("检测到已有部署配置，将进入接管向导，保留线上资源和现有密钥。");
      return adoptDeployment(prompt);
    }
    const defaultWorker = `lume-${randomBytes(3).toString("hex")}`;
    const workerName = (await prompt.text("Worker 名称", defaultWorker)).toLowerCase();
    if (!validateWorkerName(workerName)) fail("Worker 名称只能使用小写字母、数字和连字符，最长 63 字符");
    const databaseName = (await prompt.text("D1 数据库名称", `${workerName.slice(0, 56)}-db`)).toLowerCase();
    if (!validateDatabaseName(databaseName)) fail("D1 名称只能使用小写字母、数字、下划线和连字符，最长 63 字符");
    const withTelegram = await prompt.yes("配置 Telegram Bot（面板登录需要）", true);
    let botUsername = "";
    if (withTelegram) {
      botUsername = (await prompt.text("Bot 用户名（可省略 @）")).replace(/^@/, "");
      if (!/^[A-Za-z0-9_]{5,32}$/.test(botUsername)) fail("Telegram Bot 用户名格式无效");
    }
    state = {
      schemaVersion: 1,
      stage: "planned",
      workerName,
      databaseName,
      databaseId: "",
      workerUrl: "",
      adminToken: randomSecret(),
      nodeKeys: {},
      nodes: {},
      telegram: withTelegram ? {
        username: botUsername,
        webhookSecret: randomSecret(),
        bindCode: randomBytes(24).toString("hex"),
        configured: false,
      } : null,
    };
    line("");
    line("即将执行：登录 Cloudflare、创建或绑定一个 D1、迁移数据库、部署 Worker、写入 Secrets。" );
    line(`Worker: ${workerName}`);
    line(`D1:     ${databaseName}`);
    line(`私密状态只写入：${statePath}（已被 Git 忽略）`);
    if (!assumeYes && !(await prompt.yes("确认开始部署", false))) return;
    await writePrivateJson(statePath, state);
  } else {
    line(`继续未完成或已有部署：${state.workerName}`);
    if (!assumeYes && !(await prompt.yes("继续同步 Cloudflare 配置", true))) return;
  }

  await ensureCloudflareLogin();
  await findOrCreateDatabase(state, prompt);
  await writeWorkerConfig(state);
  await applyDatabaseMigrations(state);
  line("部署 Worker…");
  const deployed = await wrangler(["deploy", "--config", wranglerConfigPath], { capture: true, echo: true });
  const discoveredUrl = extractWorkerUrl(`${deployed.stdout}\n${deployed.stderr}`);
  if (!state.workerUrl && !discoveredUrl) fail("部署完成但未识别 workers.dev URL，请从 Wrangler 输出确认 URL 后重新运行 setup");
  if (discoveredUrl && discoveredUrl !== state.workerUrl) {
    state.workerUrl = discoveredUrl;
    await writePrivateJson(statePath, state);
    // Only the local configuration file is refreshed. The Worker learns its
    // own origin from the admin call below, so there is no second deploy.
    await writeWorkerConfig(state);
  }
  const pendingTelegram = Boolean(state.telegram && !state.telegram.configured);
  const secrets = {
    NODE_KEYS: JSON.stringify(state.nodeKeys),
    ADMIN_TOKEN: state.adminToken,
  };
  if (pendingTelegram) {
    secrets.TELEGRAM_WEBHOOK_SECRET = state.telegram.webhookSecret;
    secrets.TELEGRAM_BIND_CODE_HASH = createHash("sha256").update(state.telegram.bindCode).digest("hex");
  }
  await secretBulk(secrets);
  if (pendingTelegram) {
    line("接下来由 Wrangler 安全读取 Telegram Bot Token；本工具不会保存或显示它。");
    await wrangler(["secret", "put", "TELEGRAM_BOT_TOKEN", "--config", wranglerConfigPath], { interactive: true });
  }
  await registerDashboardOrigin(state);
  if (pendingTelegram) await configureTelegram(state);
  await verifyHealth(state.workerUrl);
  state.stage = "ready";
  state.keyInventory = await getServerInventory(state);
  state.revokedNodeIds = state.keyInventory.revoked_node_ids;
  await writePrivateJson(statePath, state);

  line("");
  line("后端部署完成。" );
  line(`面板：${state.workerUrl}/dashboard/`);
  if (state.telegram) {
    line(`请私聊 @${state.telegram.username} 发送：/bind ${state.telegram.bindCode}`);
    line("绑定后发送 /panel 打开面板。绑定成功后可从密码管理器删除一次性绑定码。" );
  }
  if (await prompt.yes("现在添加并安装首台 VPS", true)) await addNode(prompt, new Map());
}

function parseServices(value) {
  if (!value.trim()) return [];
  const names = [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
  for (const name of names) {
    if (!/^[A-Za-z0-9_.@-]{1,80}$/.test(name)) fail(`systemd unit 名称无效：${name}`);
  }
  if (names.length > 16) fail("最多配置 16 个 systemd 服务");
  return names.map((name) => ({ name, label: name.replace(/\.service$/, ""), severity: "P1" }));
}

function safeObserverName(value, label) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(normalized)) fail(`${label}必须使用小写字母、数字、下划线或连字符`);
  return normalized;
}

function safeProbeTarget(value) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > 253 || /[\s/@?#\\]/.test(normalized)) {
    fail("TCP 目标必须是单独的主机名或 IP，不能包含协议、端口、路径或空白");
  }
  return normalized;
}

function safeNftIdentifier(value, label) {
  const normalized = String(value || "").trim();
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(normalized)) fail(`${label}格式无效`);
  return normalized;
}

async function promptOptionalObservers(prompt) {
  const probes = [];
  const nftablesCounters = [];
  if (!(await prompt.yes("配置可选观测（ICMP / TCP / nftables）", false))) {
    return { probes, nftablesCounters };
  }
  while (await prompt.yes("添加一个通信探针", probes.length === 0)) {
    if (probes.length >= 16) fail("交互工具最多添加 16 个 TCP 探测；更多请按功能手册编辑配置");
    const kind = (await prompt.text("探针类型（icmp / tcp）", "icmp")).toLowerCase();
    if (!["icmp", "tcp"].includes(kind)) fail("探针类型只能为 icmp 或 tcp");
    const name = safeObserverName(await prompt.text("探测名称", `${kind}_${probes.length + 1}`), "探测名称");
    if (probes.some((probe) => probe.name === name)) fail(`探测名称重复：${name}`);
    const label = await prompt.text("面板显示名", `${kind.toUpperCase()} ${probes.length + 1}`);
    const target = safeProbeTarget(await prompt.text("目标主机名或 IP（不含端口）"));
    const port = kind === "tcp" ? Number(await prompt.text("TCP 端口", "443")) : 443;
    if (!Number.isInteger(port) || port < 1 || port > 65535) fail("TCP 端口必须是 1–65535 的整数");
    const targetNodeIdValue = (await prompt.text("目标节点 ID（非节点间探测可留空）", "")).toLowerCase();
    if (targetNodeIdValue && !validateNodeId(targetNodeIdValue)) fail("目标节点 ID 格式无效");
    probes.push({
      name,
      label,
      category: targetNodeIdValue ? "node-link" : "external",
      ...(targetNodeIdValue ? { target_node_id: targetNodeIdValue } : {}),
      kind,
      target,
      ...(kind === "tcp" ? { port, connect_timeout_ms: 1000 } : {}),
      timeout_seconds: 4,
      samples: kind === "icmp" ? 5 : 3,
      sample_interval_ms: 250,
      warning_ms: 500,
      critical_ms: 1500,
      warning_failure_percent: 1,
      critical_failure_percent: 60,
      severity: "P2",
      display_order: (probes.length + 1) * 10,
    });
    if (probes.length >= 16) break;
  }
  while (await prompt.yes("添加一个 nftables 规则计数观测", nftablesCounters.length === 0)) {
    if (nftablesCounters.length >= 16) fail("最多添加 16 个 nftables 计数观测");
    const name = safeObserverName(await prompt.text("计数器名称", `nft_counter_${nftablesCounters.length + 1}`), "计数器名称");
    if (nftablesCounters.some((counter) => counter.name === name)) fail(`计数器名称重复：${name}`);
    const label = await prompt.text("面板显示名", `转发规则 ${nftablesCounters.length + 1}`);
    const family = (await prompt.text("nftables family（ip / ip6 / inet）", "ip")).toLowerCase();
    if (!["ip", "ip6", "inet"].includes(family)) fail("family 只能是 ip、ip6 或 inet");
    const table = safeNftIdentifier(await prompt.text("table 名称"), "table 名称");
    const chain = safeNftIdentifier(await prompt.text("chain 名称"), "chain 名称");
    const protocol = (await prompt.text("传输协议（tcp / udp）", "tcp")).toLowerCase();
    if (!["tcp", "udp"].includes(protocol)) fail("传输协议只能是 tcp 或 udp");
    const destinationPort = Number(await prompt.text("规则匹配的目标端口", "443"));
    if (!Number.isInteger(destinationPort) || destinationPort < 1 || destinationPort > 65535) fail("目标端口必须是 1–65535 的整数");
    const ruleComment = await prompt.text("唯一规则 comment（可留空；同链同端口多条规则时必填）", "");
    if (ruleComment.length > 80 || /[\r\n\t]/.test(ruleComment)) fail("规则 comment 不能超过 80 个普通字符");
    nftablesCounters.push({
      name,
      label,
      family,
      table,
      chain,
      protocol,
      destination_port: destinationPort,
      ...(ruleComment ? { rule_comment: ruleComment } : {}),
      display_order: (nftablesCounters.length + 1) * 10,
    });
    if (nftablesCounters.length >= 16) break;
  }
  return { probes, nftablesCounters };
}

function nextDisplayOrder(state, offset) {
  return (Object.keys(state.nodes).length + offset + 1) * 10;
}

export function normalizeNodeSpec(spec) {
  assertPlainObject(spec, "节点定义");
  const id = String(spec.id ?? "").trim().toLowerCase();
  if (!validateNodeId(id)) fail(`节点 ID 无效：${JSON.stringify(spec.id ?? null)}`);
  const services = Array.isArray(spec.services)
    ? spec.services.join(",")
    : String(spec.services ?? "");
  const ssh = String(spec.ssh ?? "").trim();
  if (ssh && !validateSshTarget(ssh)) fail(`SSH 目标格式无效：${ssh}`);
  return {
    id,
    displayName: String(spec.name ?? spec.display_name ?? id),
    role: String(spec.role ?? "VPS"),
    region: String(spec.region ?? "unspecified"),
    shortMark: String(
      spec.mark ?? spec.short_mark ?? id.replace(/[-_]/g, "").slice(0, 3).toUpperCase(),
    ),
    services,
    ssh,
    probes: Array.isArray(spec.probes) ? spec.probes : [],
    nftablesCounters: Array.isArray(spec.nftables_counters) ? spec.nftables_counters : [],
  };
}

/**
 * Node keys live in one Worker secret, so a batch writes every configuration
 * first and submits the complete map once instead of once per node.
 */
async function createNodeRecords(state, specs) {
  await assertServerInventory(state);
  const pending = [];
  for (const [offset, spec] of specs.entries()) {
    if (state.nodeKeys[spec.id]) fail(`节点 ${spec.id} 已存在；不会生成第二套同名密钥`);
    if (state.retiredNodes?.[spec.id]) fail(`节点 ${spec.id} 已退役，请使用 npm run node:restore`);
    if (pending.some((entry) => entry.spec.id === spec.id)) fail(`清单中的节点 ID 重复：${spec.id}`);
    pending.push({
      spec,
      secret: randomSecret(),
      displayOrder: nextDisplayOrder(state, offset),
    });
  }
  for (const entry of pending) {
    const config = createAgentConfig({
      id: entry.spec.id,
      displayName: entry.spec.displayName,
      shortMark: entry.spec.shortMark,
      role: entry.spec.role,
      region: entry.spec.region,
      displayOrder: entry.displayOrder,
      endpoint: state.workerUrl,
      secret: entry.secret,
      services: parseServices(entry.spec.services),
      probes: entry.spec.probes,
      nftablesCounters: entry.spec.nftablesCounters,
    });
    state.nodeKeys[entry.spec.id] = entry.secret;
    state.nodes[entry.spec.id] = {
      configPath: `${privateDirName}/nodes/${entry.spec.id}/config.json`,
      sshTarget: entry.spec.ssh,
      installed: false,
      pendingApply: true,
    };
    await writePrivateJson(join(privateDir, "nodes", entry.spec.id, "config.json"), config);
    line(`✓ 私密节点配置：${join(privateDir, "nodes", entry.spec.id, "config.json")}`);
  }
  await writePrivateJson(statePath, state);
  await publishNodeKeys(state);
  line(`✓ 已安全更新完整 NODE_KEYS（${Object.keys(state.nodeKeys).length} 个节点）`);
  return pending;
}

async function readNodeManifest(file) {
  const parsed = JSON.parse(await readFile(resolve(file), "utf8"));
  const list = Array.isArray(parsed) ? parsed : parsed?.nodes;
  if (!Array.isArray(list) || list.length === 0) fail("批量清单必须是非空 JSON 数组，或包含 nodes 数组的对象");
  if (list.length > 64) fail("单次批量最多 64 个节点");
  return list.map(normalizeNodeSpec);
}

async function addNode(prompt, options) {
  const state = await loadState();
  if (state.stage !== "ready") fail("后端尚未部署完成，请先重新运行 npm run setup");
  const manifest = options.get("from-file");
  const flagId = options.get("id");
  let specs;
  if (typeof manifest === "string") {
    specs = await readNodeManifest(manifest);
    line(`从清单读取 ${specs.length} 个节点：${specs.map((spec) => spec.id).join("、")}`);
  } else if (typeof flagId === "string") {
    specs = [normalizeNodeSpec({
      id: flagId,
      name: options.get("name"),
      role: options.get("role"),
      region: options.get("region"),
      mark: options.get("mark"),
      services: options.get("services"),
      ssh: options.get("ssh"),
    })];
  } else {
    const id = (await prompt.text("节点 ID（小写，稳定且唯一）")).toLowerCase();
    if (!validateNodeId(id)) fail("节点 ID 必须匹配 [a-z0-9][a-z0-9_-]{0,31}");
    const displayName = await prompt.text("面板显示名", id);
    const role = await prompt.text("用途", "VPS");
    const region = await prompt.text("国家 / 城市", "unspecified");
    const shortMark = await prompt.text("1–4 位短标记", id.replace(/[-_]/g, "").slice(0, 3).toUpperCase());
    const units = await prompt.text("只读监测的 systemd 服务（逗号分隔，可留空）", "");
    const optionalObservers = await promptOptionalObservers(prompt);
    const target = await prompt.text("SSH 主机或 ~/.ssh/config 别名（留空则稍后安装）", "");
    specs = [normalizeNodeSpec({
      id,
      name: displayName,
      role,
      region,
      mark: shortMark,
      services: units,
      ssh: target,
      probes: optionalObservers.probes,
      nftables_counters: optionalObservers.nftablesCounters,
    })];
  }
  await createNodeRecords(state, specs);
  for (const spec of specs) {
    if (spec.ssh) await installNode(spec.id, spec.ssh);
    else line(`稍后安装：cd worker && npm run node:install -- ${spec.id} --ssh <SSH别名>`);
  }
}

async function configureNodeObservers(prompt, id) {
  if (!validateNodeId(id)) fail("节点 ID 格式无效");
  const state = await loadState();
  if (!state.nodes[id]) fail(`本地状态中没有节点 ${id}`);
  const configPath = join(privateDir, "nodes", id, "config.json");
  if (!(await exists(configPath))) fail(`节点配置不存在：${configPath}`);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  assertPlainObject(config, "节点配置");
  const original = JSON.stringify(config);
  line(`${id} 当前有 ${config.services.length} 个服务、${config.probes.length} 个探针和 ${config.nftables_counters?.length || 0} 个计数器。`);
  if (await prompt.yes("修改 systemd 服务列表", false)) config.services = parseServices(await prompt.text("服务名（逗号分隔，留空清空）", ""));
  const action = await prompt.text("通信探针和计数器：1 保留 / 2 追加 / 3 全部重设 / 4 删除指定项", "1");
  if (!["1", "2", "3", "4"].includes(action)) fail("请选择 1–4");
  if (action === "4") {
    for (const key of ["probes", "nftables_counters"]) {
      const entries = config[key] || [];
      if (!entries.length) continue;
      entries.forEach((entry, index) => line(`  ${index + 1}. ${entry.name} · ${entry.label || ""}`));
      const selected = await prompt.text(`删除 ${key === "probes" ? "探针" : "计数器"} 的编号（逗号分隔，留空保留）`);
      const indices = selected ? selected.split(",").map((value) => Number(value.trim()) - 1) : [];
      if (indices.some((value) => !Number.isInteger(value) || value < 0 || value >= entries.length)) fail("删除编号不在列表中");
      config[key] = entries.filter((_entry, index) => !indices.includes(index));
    }
  } else if (action !== "1") {
    const observers = await promptOptionalObservers(prompt);
    config.probes = action === "2" ? restorePeerProbes(config.probes, observers.probes) : observers.probes;
    const counters = action === "2" ? [...(config.nftables_counters || []), ...observers.nftablesCounters] : observers.nftablesCounters;
    if (new Set(counters.map((entry) => entry.name)).size !== counters.length) fail("计数器名称重复");
    config.nftables_counters = counters;
  }
  if (JSON.stringify(config) === original) { line("配置没有变化。"); return; }
  await writePrivateJson(join(privateDir, "backups", `${id}-config-${Date.now()}.json`), JSON.parse(original));
  await writePrivateJson(configPath, config);
  state.nodes[id].pendingApply = true;
  await writePrivateJson(statePath, state);
  line(`✓ 已更新私密配置：${configPath}`);
  if (await prompt.yes("立即校验并部署到该 VPS", true)) await applyNodes(prompt, [id], state);
  else line("已保存待部署状态。稍后运行 npm run node:apply。");
}

async function nodeTarget(prompt, state, id, target = "") {
  const chosen = target || state.nodes[id]?.sshTarget || await prompt.text(`${id} 的 SSH 别名`, id);
  if (!validateSshTarget(chosen)) fail("SSH 别名无效");
  state.nodes[id].sshTarget = chosen;
  return chosen;
}

async function applyNodes(prompt, ids, state = null) {
  state ||= await loadState();
  if (ids.some((id) => state.nodes[id]?.pendingRestore || state.nodes[id]?.pendingRetire)) fail("有节点正在下线或恢复，请重试对应操作完成后再部署配置");
  await applyPending(state, ids, {
    save: (value) => writePrivateJson(statePath, value),
    deploy: async (id) => {
      const target = await nodeTarget(prompt, state, id);
      await installNode(id, target, { upgrade: Boolean(state.nodes[id].installed), reconcile: true, state });
    },
  });
}

async function download(url) {
  let response;
  try {
    response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(60_000) });
  } catch (error) {
    throw new DownloadUnavailableError(`下载不可用：${error.message}`);
  }
  if (!response.ok) throw new DownloadUnavailableError(`下载失败（HTTP ${response.status}）：${url}`);
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxDownloadBytes) fail("下载文件超过 64 MiB 限制");
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length > maxDownloadBytes) fail("下载文件超过 64 MiB 限制");
  return body;
}

async function cacheVerifiedBinary(cachePath, binary, digest) {
  try {
    await mkdir(cacheDir, { recursive: true, mode: 0o700 });
    await writeFile(cachePath, binary, { mode: 0o700 });
    await writeFile(`${cachePath}.sha256`, `${digest}\n`, { mode: 0o600 });
  } catch {
    // A cache miss only costs a download; never fail an install over it.
  }
}

/**
 * Installing several nodes of the same architecture used to re-download and
 * re-verify the release binary once per node. The cache keeps the verified
 * bytes plus their digest and re-checks the digest before every reuse, so a
 * corrupted or tampered cache file is discarded rather than trusted.
 */
async function obtainAgentBinary(version, architecture, outputPath) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(releaseRepository)) fail("LUME_RELEASE_REPOSITORY 必须使用 owner/repository 格式");
  const asset = `vpsmon-agent-linux-${architecture}`;
  const baseUrl = `https://github.com/${releaseRepository}/releases/download/v${version}`;
  const releaseCachePath = join(cacheDir, `${asset}-${version}`);
  const sourceCachePath = join(cacheDir, `${asset}-${version}-source`);

  for (const [cachePath, origin] of [[releaseCachePath, "release"], [sourceCachePath, "source"]]) {
    if (!(await exists(cachePath)) || !(await exists(`${cachePath}.sha256`))) continue;
    const expected = (await readFile(`${cachePath}.sha256`, "utf8")).trim().toLowerCase();
    const binary = await readFile(cachePath);
    const actual = createHash("sha256").update(binary).digest("hex");
    if (/^[a-f0-9]{64}$/.test(expected) && actual === expected) {
      await writeFile(outputPath, binary, { mode: 0o700 });
      line(`✓ 复用本机已校验缓存（${origin}）：SHA-256 ${actual}`);
      return origin;
    }
    line("! 本机缓存校验失败，已丢弃并重新获取。");
    await rm(cachePath, { force: true });
    await rm(`${cachePath}.sha256`, { force: true });
  }

  try {
    const [binary, manifestBuffer] = await Promise.all([
      download(`${baseUrl}/${asset}`),
      download(`${baseUrl}/SHA256SUMS`),
    ]);
    const expected = parseReleaseChecksum(manifestBuffer.toString("utf8"), asset);
    const actual = createHash("sha256").update(binary).digest("hex");
    if (actual !== expected) fail("Agent SHA-256 校验失败，已停止安装，不会降级为源码构建");
    await writeFile(outputPath, binary, { mode: 0o700 });
    await cacheVerifiedBinary(releaseCachePath, binary, actual);
    line(`✓ GitHub Release SHA-256：${actual}`);
    return "release";
  } catch (error) {
    if (!(error instanceof DownloadUnavailableError)) throw error;
    const go = commandProbe("go", ["version"]);
    if (!go.found || go.status !== 0) {
      fail(`GitHub Release 暂不可用，且本机没有 Go 1.26+，无法安全生成 Agent。原始错误：${error.message}`);
    }
    line(`! GitHub Release 暂不可用，改用本机 ${go.output.split(/\r?\n/)[0]} 从当前源码构建。`);
    await run("go", [
      "build", "-trimpath",
      `-ldflags=-s -w -X main.version=${version}`,
      "-o", outputPath,
      "./cmd/vpsmon-agent",
    ], {
      cwd: agentDir,
      env: { ...process.env, CGO_ENABLED: "0", GOOS: "linux", GOARCH: architecture },
    });
    const built = await readFile(outputPath);
    await cacheVerifiedBinary(sourceCachePath, built, createHash("sha256").update(built).digest("hex"));
    return "source";
  }
}

export function normalizeArchitecture(value) {
  const architecture = String(value || "").trim().toLowerCase();
  if (["x86_64", "amd64"].includes(architecture)) return "amd64";
  if (["aarch64", "arm64"].includes(architecture)) return "arm64";
  fail(`暂不支持远端架构：${architecture || "未知"}`);
}

/**
 * Four SSH round trips instead of seven. Reading the architecture and creating
 * the restricted stage share one connection, the permission fixes ride along
 * with the installer, and the final connection verifies and cleans up together.
 * The stage is still created with mode 0700 before anything is copied into it,
 * so a staged configuration is never reachable by other local users.
 */
async function installNode(id, target, options = {}) {
  if (!validateSshTarget(target)) fail("SSH 目标格式无效；复杂端口请写入 ~/.ssh/config 后使用别名");
  const state = options.state || await loadState();
  if (!state.nodes[id] || !state.nodeKeys[id]) fail(`本地状态中没有节点 ${id}`);
  const configPath = join(privateDir, "nodes", id, "config.json");
  if (!(await exists(configPath))) fail(`节点配置不存在：${configPath}`);
  const version = await readVersion();
  let installer = options.upgrade ? "upgrade-agent.sh" : "install-agent.sh";
  const resuming = Boolean(state.nodes[id].deploymentStarted || options.reconcile);

  const localStage = await mkdtemp(join(tmpdir(), "lume-stage-"));
  const remoteStage = `/tmp/vpsmon-stage.${randomBytes(8).toString("hex")}`;
  const payloads = [
    "vpsmon-agent",
    "config.json",
    "vpsmon-agent.service",
    "vpsmon-nftables-snapshot.service",
    "vpsmon-nftables-snapshot.timer",
    installer,
  ];
  let remoteStagePresent = false;
  try {
    line(`连接 ${target} 并创建受限临时目录…`);
    const bootstrap = await run("ssh", [
      target,
      `uname -m && umask 077 && mkdir -m 700 ${remoteStage} && echo lume_stage_ready && if [ -f /opt/vpsmon/vpsmon-agent ]; then echo lume_agent_present; fi`,
    ], { capture: true });
    const bootstrapLines = bootstrap.stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    if (!bootstrapLines.includes("lume_stage_ready")) fail("远端临时目录创建失败");
    remoteStagePresent = true;
    const architecture = normalizeArchitecture(bootstrapLines[0]);
    if (resuming) installer = bootstrapLines.includes("lume_agent_present") ? "upgrade-agent.sh" : "install-agent.sh";
    payloads[payloads.length - 1] = installer;
    line(`获取并校验 Lume v${version} linux/${architecture}…`);

    await obtainAgentBinary(version, architecture, join(localStage, "vpsmon-agent"));
    await writeFile(join(localStage, "config.json"), await readFile(configPath), { mode: 0o600 });
    for (const unit of ["vpsmon-agent.service", "vpsmon-nftables-snapshot.service", "vpsmon-nftables-snapshot.timer"]) {
      await writeFile(join(localStage, unit), await readFile(join(deployDir, unit)), { mode: 0o644 });
    }
    await writeFile(join(localStage, installer), await readFile(join(deployDir, installer)), { mode: 0o700 });
    const checksums = [];
    for (const payload of payloads) {
      const digest = createHash("sha256").update(await readFile(join(localStage, payload))).digest("hex");
      checksums.push(`${digest}  ${payload}`);
    }
    await writeFile(join(localStage, "checksums.sha256"), `${checksums.join("\n")}\n`, { mode: 0o600 });

    await run("scp", [
      ...payloads.map((name) => join(localStage, name)),
      join(localStage, "checksums.sha256"),
      `${target}:${remoteStage}/`,
    ]);

    state.nodes[id].deploymentStarted = true;
    await writePrivateJson(statePath, state);
    line(`${installer === "upgrade-agent.sh" ? "备份并更新" : "安装"} Agent；若 sudo 需要密码，请在提示中输入。`);
    const deployedAfter = Math.floor(Date.now() / 1000);
    await run("ssh", ["-t", target, [
      `chmod 700 ${remoteStage}/vpsmon-agent ${remoteStage}/${installer}`,
      `chmod 600 ${remoteStage}/config.json ${remoteStage}/checksums.sha256`,
      `chmod 644 ${remoteStage}/vpsmon-agent.service ${remoteStage}/vpsmon-nftables-snapshot.service ${remoteStage}/vpsmon-nftables-snapshot.timer`,
      `sudo sh ${remoteStage}/${installer} ${remoteStage}`,
      ...(options.activate ? ["sudo systemctl enable --now vpsmon-agent.service"] : []),
    ].join(" && ")], { interactive: true });

    const verify = await run("ssh", [
      target,
      `systemctl is-active vpsmon-agent.service; rm -rf -- ${remoteStage} && echo lume_stage_removed`,
    ], { capture: true, allowFailure: true });
    const verifyLines = verify.stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    if (verifyLines.includes("lume_stage_removed")) remoteStagePresent = false;
    const active = verifyLines.includes("active");
    if (!active && !(installer === "upgrade-agent.sh" && !options.activate && verifyLines.includes("inactive"))) fail("Agent 部署后的服务状态异常");

    state.nodes[id].sshTarget = target;
    state.nodes[id].installed = true;
    await writePrivateJson(statePath, state);
    line(`✓ ${id} 已部署。`);
    if (!active) {
      delete state.nodes[id].deploymentStarted;
      delete state.nodes[id].pendingApply;
      await writePrivateJson(statePath, state);
      line("Agent 原先已停用，配置已更新并保留停用状态。");
      return;
    }

    // The Agent sends its first report before starting the interval timer, so
    // this normally confirms in a few seconds rather than a full interval.
    line("等待首份认证上报…");
    const reported = await waitForFirstReport(state, id, 90, deployedAfter);
    if (reported) {
      delete state.nodes[id].pendingApply;
      delete state.nodes[id].deploymentStarted;
      await writePrivateJson(statePath, state);
      line(`✓ ${id} 已上线，Worker 已接受部署后的新上报。`);
    }
    else fail(`未收到 ${id} 部署后的新上报。检查 ssh ${target} journalctl -u vpsmon-agent.service -n 30 --no-pager，然后运行 npm run node:apply 重试。`);
  } finally {
    if (remoteStagePresent) {
      await run("ssh", [target, `rm -rf -- ${remoteStage}`], { capture: true, allowFailure: true }).catch(() => {});
    }
    await rm(localStage, { recursive: true, force: true });
  }
}

async function uninstallRemoteAgent(target) {
  const localStage = await mkdtemp(join(tmpdir(), "lume-uninstall-"));
  const remoteStage = `/tmp/vpsmon-stage.${randomBytes(8).toString("hex")}`;
  try {
    await run("ssh", [target, `umask 077 && mkdir -m 700 ${remoteStage}`]);
    await writeFile(join(localStage, "uninstall-agent.sh"), await readFile(join(deployDir, "uninstall-agent.sh")), { mode: 0o700 });
    await run("scp", [join(localStage, "uninstall-agent.sh"), `${target}:${remoteStage}/`]);
    await run("ssh", ["-t", target, `sudo sh ${remoteStage}/uninstall-agent.sh --confirm && rm -rf -- ${remoteStage}`], { interactive: true });
  } finally {
    await rm(localStage, { recursive: true, force: true });
  }
}

/**
 * Peers keep probing a decommissioned node until their own configuration is
 * updated. The Worker already hides those links, but the packets are still
 * sent, so the candidate configurations are written out here and deployed
 * through the normal upgrade flow rather than by silently touching a live VPS.
 */
async function peersTargeting(state, id) {
  const peers = [];
  for (const peerId of Object.keys(state.nodes)) {
    if (peerId === id) continue;
    const peerConfigPath = join(privateDir, "nodes", peerId, "config.json");
    if (!(await exists(peerConfigPath))) continue;
    let config;
    try {
      config = JSON.parse(await readFile(peerConfigPath, "utf8"));
    } catch {
      continue;
    }
    const probes = Array.isArray(config.probes) ? config.probes : [];
    const matching = probes.filter((probe) => probe && probe.target_node_id === id);
    if (matching.length > 0) {
      peers.push({ peerId, peerConfigPath, config, names: matching.map((probe) => probe.name) });
    }
  }
  return peers;
}

async function removeNode(prompt, id, options) {
  if (!validateNodeId(id)) fail("节点 ID 格式无效");
  const state = await loadState();
  if (!state.nodes[id] && state.retiredNodes?.[id]) {
    const pending = [];
    for (const peerId of Object.keys(state.retiredNodes[id].peerProbes || {})) {
      if (!state.nodes[peerId]) continue;
      const path = join(privateDir, "nodes", peerId, "config.json");
      const config = JSON.parse(await readFile(path, "utf8"));
      const probes = config.probes.filter((probe) => probe.target_node_id !== id);
      if (probes.length !== config.probes.length || state.nodes[peerId].pendingApply) {
        config.probes = probes;
        await writePrivateJson(path, config);
        pending.push(peerId);
      }
    }
    if (pending.length) await applyNodes(prompt, pending, state);
    line(`✓ ${id} 已退役，对端配置已处理。`);
    return;
  }
  if (!state.nodes[id] && !state.nodeKeys[id]) fail(`本地状态中没有节点 ${id}`);
  const keyAlreadyRevoked = !state.nodeKeys[id];
  const assumeYes = options.get("yes") === true;
  const uninstall = options.get("uninstall") === true;
  const sshFlag = options.get("ssh");
  const target = typeof sshFlag === "string" ? sshFlag : (state.nodes[id]?.sshTarget || "");
  if (target && !validateSshTarget(target)) fail("SSH 目标格式无效");
  const peers = await peersTargeting(state, id);

  line(`将下线节点：${id}`);
  line(target
    ? `  1. 通过 SSH ${target} ${uninstall ? "卸载 Agent（同时停用服务）" : "停止并停用 Agent"}`
    : "  1. 跳过远端停机：未提供 SSH 目标，请自行确认该 VPS 上的 Agent 已停止");
  line("  2. 从完整 NODE_KEYS 中移除该节点密钥并重新提交");
  line("  3. 在 Worker 上标记退役，隐藏该节点及所有指向它的探针与链路");
  if (peers.length > 0) {
      line(`  4. 自动更新并部署 ${peers.length} 个对端配置，停止指向它的探测`);
  }
  line("D1 历史样本会保留，按既有保留策略自然过期；退役标记不会被后续上报覆盖，因此顺序不影响结果。");
  if (!assumeYes && !(await prompt.yes("确认下线", false))) return;
  await assertServerInventory(state);
  state.retiredNodes ||= {};
  if (!state.retiredNodes[id]) {
    const archivedPath = join(privateDir, "retired", id, "config.json");
    const currentConfig = JSON.parse(await readFile(join(privateDir, "nodes", id, "config.json"), "utf8"));
    await writePrivateJson(archivedPath, currentConfig);
    state.retiredNodes[id] = { configPath: archivedPath, sshTarget: target, uninstalled: uninstall, peerProbes: Object.fromEntries(peers.map((peer) => [peer.peerId, peer.config.probes.filter((probe) => probe.target_node_id === id)])) };
    await writePrivateJson(statePath, state);
  }

  if (target) {
    if (uninstall) {
      line(`卸载 ${target} 上的 Agent…`);
      await uninstallRemoteAgent(target);
    } else {
      line(`停止 ${target} 上的 Agent…`);
      await run("ssh", ["-t", target, "sudo systemctl disable --now vpsmon-agent.service vpsmon-nftables-snapshot.timer"], { interactive: true });
    }
  }

  // The key is revoked first and the local node record is kept until the
  // Worker has acknowledged the retirement, so an interrupted removal can be
  // re-run with the same command instead of leaving an unreachable half state.
  delete state.nodeKeys[id];
  if (state.nodes[id]) state.nodes[id].pendingRetire = true;
  await writePrivateJson(statePath, state);
  if (keyAlreadyRevoked) line(`· ${id} 的密钥此前已从 NODE_KEYS 移除，继续完成退役`);
  await publishNodeKeys(state);
  line(`✓ 已提交不含 ${id} 的完整 NODE_KEYS（${Object.keys(state.nodeKeys).length} 个节点）`);

  const retire = await adminFetch(state, `/api/v1/admin/nodes/${id}/retire`, { method: "POST" });
  if (!retire.ok) {
    fail(`标记退役失败（HTTP ${retire.status}）。密钥已撤销，重试同一条命令即可续做：npm run node:remove -- ${id} --yes`);
  }
  delete state.nodes[id];
  state.retiredNodes = {
    ...(state.retiredNodes ?? {}),
    [id]: { ...state.retiredNodes[id], retiredAt: Math.floor(Date.now() / 1000), sshTarget: target, uninstalled: uninstall },
  };
  await writePrivateJson(statePath, state);
  line("✓ 已在 Worker 标记退役：面板、/status 以及所有指向它的链路立即隐藏");

  for (const peer of peers) {
    peer.config.probes = peer.config.probes.filter((probe) => probe.target_node_id !== id);
    await writePrivateJson(peer.peerConfigPath, peer.config);
    state.nodes[peer.peerId].pendingApply = true;
    line(`✓ 已更新对端配置 ${peer.peerId}（移除 ${peer.names.join("、")}），即将部署。`);
  }
  await writePrivateJson(statePath, state);

  await rm(join(privateDir, "nodes", id), { recursive: true, force: true });
  line(`✓ 已删除本地私密配置：${privateDirName}/nodes/${id}/`);
  await applyNodes(prompt, peers.map((peer) => peer.peerId), state);
}

async function restoreNode(prompt, id, options) {
  if (!validateNodeId(id)) fail("节点 ID 格式无效");
  const state = await loadState();
  const archived = state.retiredNodes?.[id];
  if (!archived) fail(`节点 ${id} 不在退役记录中`);
  if (!(options.get("yes") === true) && !(await prompt.yes(`恢复 ${id} 并自动恢复相关对端探针`, true))) return;
  await assertServerInventory(state);
  if (!state.nodes[id]?.pendingRestore) {
    let config, target = options.get("ssh") || archived.sshTarget;
    const archivedPath = join(privateDir, "retired", id, "config.json");
    if (await exists(archivedPath)) config = JSON.parse(await readFile(archivedPath, "utf8"));
    else {
      const imported = await readNodeConfiguration(prompt, id, target, state.workerUrl);
      config = imported.config;
      target = imported.target;
    }
    validateImportedConfig(config, id, state.workerUrl);
    if (!target) target = await prompt.text("SSH 别名", id);
    if (!validateSshTarget(target)) fail("SSH 别名无效");
    config.secret = randomSecret();
    state.nodeKeys[id] = config.secret;
    state.nodes[id] = { sshTarget: target, installed: !archived.uninstalled, pendingRestore: true, pendingApply: true };
    await writePrivateJson(join(privateDir, "nodes", id, "config.json"), config);
    await writePrivateJson(statePath, state);
  }
  if (typeof options.get("ssh") === "string") state.nodes[id].sshTarget = options.get("ssh");
  await publishNodeKeys(state);
  if ((state.revokedNodeIds || []).includes(id)) {
    state.revokedNodeIds = state.revokedNodeIds.filter((entry) => entry !== id);
    await publishRevokedNodeIds(state);
  }
  await installNode(id, await nodeTarget(prompt, state, id), { upgrade: state.nodes[id].installed, reconcile: true, activate: true, state });
  const result = await adminFetch(state, `/api/v1/admin/nodes/${id}/restore`, { method: "POST" });
  if (!result.ok) fail(`恢复目录失败（HTTP ${result.status}），重试 npm run node:restore -- ${id}`);
  const peers = [];
  for (const [peerId, probes] of Object.entries(archived.peerProbes || {})) {
    if (!state.nodes[peerId]) continue;
    const path = join(privateDir, "nodes", peerId, "config.json");
    const config = JSON.parse(await readFile(path, "utf8"));
    config.probes = restorePeerProbes(config.probes, probes);
    await writePrivateJson(path, config);
    peers.push(peerId);
  }
  await applyNodes(prompt, peers, state);
  delete state.nodes[id].pendingRestore;
  delete state.nodes[id].pendingApply;
  delete state.retiredNodes[id];
  await writePrivateJson(statePath, state);
  await rm(join(privateDir, "retired", id), { recursive: true, force: true });
  line(`✓ ${id} 已恢复，密钥已轮换，Agent 和相关对端配置已上线。`);
}

/**
 * The revocation list is the fallback for the case the full NODE_KEYS map can
 * no longer be rebuilt. It is checked before the key lookup, so it stops an old
 * secret immediately without needing every other node's secret.
 */
async function revokeNode(id, options) {
  if (!validateNodeId(id)) fail("节点 ID 格式无效");
  const state = await loadState();
  await assertServerInventory(state);
  const revoked = new Set(Array.isArray(state.revokedNodeIds) ? state.revokedNodeIds : []);
  const undo = options.get("undo") === true;
  if (undo) revoked.delete(id);
  else revoked.add(id);
  if (revoked.size > 256) fail("撤销列表最多 256 个节点");
  state.revokedNodeIds = [...revoked].sort();
  await writePrivateJson(statePath, state);
  await publishRevokedNodeIds(state);
  line(undo
    ? `✓ 已从 REVOKED_NODE_IDS 移除 ${id}（当前 ${state.revokedNodeIds.length} 项）`
    : `✓ 已将 ${id} 加入 REVOKED_NODE_IDS（当前 ${state.revokedNodeIds.length} 项），旧密钥立即失效`);
}

async function syncKeys() {
  const state = await loadState();
  await publishNodeKeys(state);
  line(`✓ 已提交完整 NODE_KEYS（${Object.keys(state.nodeKeys).length} 个节点），未显示任何密钥。`);
}

async function showStatus() {
  const state = await loadState(false);
  if (!state) {
    line("未找到本地部署管理状态，尚未检查线上服务。");
    line((await exists(wranglerConfigPath))
      ? "检测到已有 Worker 配置。运行 npm run setup:adopt 接管现有部署。"
      : "首次部署：npm run setup；已有线上部署：npm run setup:adopt。");
    return;
  }
  line(`Worker  ${state.workerName}`);
  line(`D1      ${state.databaseName}`);
  line(`URL     ${state.workerUrl || "尚未部署"}`);
  line(`阶段    ${state.stage}`);
  line(`节点    ${Object.keys(state.nodes).length}`);
  let remote = null;
  if (state.workerUrl) {
    try {
      remote = await adminNodeList(state);
    } catch {
      remote = null;
    }
  }
  const remoteById = new Map((remote ?? []).map((node) => [node.node_id, node]));
  for (const [id, node] of Object.entries(state.nodes)) {
    const seen = remoteById.get(id);
    const reported = seen?.last_report_age_seconds;
    const detail = seen === undefined
      ? "尚未上报"
      : reported === null
        ? "尚未上报"
        : `${reported} 秒前上报`;
    line(`  ${node.installed ? "✓" : "·"} ${id}${node.sshTarget ? `  (${node.sshTarget})` : ""}  ${detail}${node.pendingApply ? " · 配置待部署" : ""}${node.pendingRestore ? " · 恢复待完成" : ""}`);
  }
  const retiredLocal = Object.keys(state.retiredNodes ?? {});
  if (retiredLocal.length > 0) line(`已下线  ${retiredLocal.join("、")}`);
  const revoked = Array.isArray(state.revokedNodeIds) ? state.revokedNodeIds : [];
  if (revoked.length > 0) line(`已撤销  ${revoked.join("、")}`);
  if (remote) {
    const orphaned = remote.filter((node) => !node.retired && !state.nodes[node.node_id]);
    if (orphaned.length > 0) {
      line(`! Worker 上还有本地状态中没有的活动节点：${orphaned.map((node) => node.node_id).join("、")}`);
    }
  }
  if (state.workerUrl) await verifyHealth(state.workerUrl);
}

function usage() {
  line(`Lume 部署管理工具

用法：
  node tools/lumectl.mjs manage
  node tools/lumectl.mjs adopt
  node tools/lumectl.mjs doctor
  node tools/lumectl.mjs setup [--yes]
  node tools/lumectl.mjs status
  node tools/lumectl.mjs node add [--id ID --name 名称 --role 用途 --region 地区 --mark 标记 --services a,b --ssh 别名]
  node tools/lumectl.mjs node add --from-file nodes.json
  node tools/lumectl.mjs node configure <NODE_ID>
  node tools/lumectl.mjs node apply [NODE_ID] [--pending]
  node tools/lumectl.mjs node restore [NODE_ID] [--ssh 别名]
  node tools/lumectl.mjs node install <NODE_ID> --ssh <SSH别名>
  node tools/lumectl.mjs node remove <NODE_ID> [--ssh 别名] [--uninstall] [--yes]
  node tools/lumectl.mjs node revoke <NODE_ID> [--undo]
  node tools/lumectl.mjs node sync-keys

不带 --id 或 --from-file 时 node add 仍是交互式的。批量清单为 JSON 数组，每项至少包含 id：
  [{"id":"hk-01","name":"HK 01","role":"中转","region":"HK","ssh":"hk-01"}]

快捷入口（worker 目录）：npm run doctor / npm run setup / npm run node:add /
npm run node:install / npm run node:remove / npm run node:revoke

安全说明：Secret 只写入 Cloudflare 和 ${privateDirName}/ 私有目录；该目录已被 Git 忽略。`);
}

async function pickNode(prompt, { retired = false } = {}) {
  const state = await loadState();
  const ids = Object.keys(retired ? state.retiredNodes || {} : state.nodes);
  if (!ids.length) fail(retired ? "没有可恢复的退役节点" : "没有已登记节点，请先接管部署或新增节点");
  ids.forEach((id, index) => line(`  ${index + 1}. ${id}`));
  const choice = await prompt.text("选择节点编号或输入节点 ID", "1");
  const id = /^\d+$/.test(choice) ? ids[Number(choice) - 1] : choice;
  if (!ids.includes(id)) fail("请选择列表中的节点");
  return id;
}

async function manage(prompt) {
  while (true) {
    line("\nLume 管理\n  1. 从零部署\n  2. 接管已有部署\n  3. 查看状态\n  4. 新增 VPS\n  5. 配置节点\n  6. 部署配置 / 更新 Agent\n  7. 下线节点\n  8. 恢复节点\n  9. 下线并卸载 Agent\n  0. 退出");
    const choice = await prompt.text("选择操作", "0");
    if (choice === "0") return;
    try {
      if (choice === "1") await setup(prompt, false);
      else if (choice === "2") await adoptDeployment(prompt);
      else if (choice === "3") await showStatus();
      else if (choice === "4") await addNode(prompt, new Map());
      else if (choice === "5") await configureNodeObservers(prompt, await pickNode(prompt));
      else if (choice === "6") await applyNodes(prompt, [await pickNode(prompt)]);
      else if (choice === "7" || choice === "9") await removeNode(prompt, await pickNode(prompt), new Map(choice === "9" ? [["uninstall", true]] : []));
      else if (choice === "8") await restoreNode(prompt, await pickNode(prompt, { retired: true }), new Map());
      else line("请输入 0–9。");
    } catch (error) { line(`操作未完成：${error.message}`); }
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0] || "manage";
  if (command === "help" || command === "--help" || command === "-h") return usage();
  if (command === "doctor") {
    if (!(await doctor())) process.exitCode = 1;
    return;
  }
  if (command === "status") return showStatus();
  const { flags, positional } = parseFlags(argv);
  const prompt = makePrompter();
  try {
    if (command === "manage") return await manage(prompt);
    if (command === "adopt") return await adoptDeployment(prompt);
    if (command === "setup") return await setup(prompt, flags.get("yes") === true);
    if (command === "node") {
      const action = positional[1];
      const nodeId = positional[2];
      if (action === "add") return await addNode(prompt, flags);
      if (action === "sync-keys") return await syncKeys();
      if (action === "configure") {
        return await configureNodeObservers(prompt, nodeId || await pickNode(prompt));
      }
      if (action === "apply") {
        const state = await loadState();
        const ids = flags.get("pending") === true
          ? Object.keys(state.nodes).filter((id) => state.nodes[id].pendingApply && !state.nodes[id].pendingRestore)
          : [nodeId || await pickNode(prompt)];
        if (!ids.length) { line("没有待部署的配置。"); return; }
        if (ids.some((id) => state.nodes[id]?.pendingRestore)) fail("节点恢复尚未完成，请运行 npm run node:restore");
        if (typeof flags.get("ssh") === "string") for (const id of ids) await nodeTarget(prompt, state, id, flags.get("ssh"));
        return await applyNodes(prompt, ids, state);
      }
      if (action === "restore") return await restoreNode(prompt, nodeId || await pickNode(prompt, { retired: true }), flags);
      if (action === "install") {
        const id = nodeId || await pickNode(prompt);
        const state = await loadState();
        return await installNode(id, await nodeTarget(prompt, state, id, flags.get("ssh")), { state });
      }
      if (action === "remove") {
        return await removeNode(prompt, nodeId || await pickNode(prompt), flags);
      }
      if (action === "revoke") {
        if (!nodeId) fail("用法：node revoke <NODE_ID> [--undo]");
        return await revokeNode(nodeId, flags);
      }
    }
    usage();
    process.exitCode = 2;
  } finally {
    prompt.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(toolFile)) {
  main().catch((error) => {
    process.stderr.write(`\n错误：${error.message}\n`);
    process.exitCode = 1;
  });
}
