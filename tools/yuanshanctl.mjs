#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const toolFile = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(toolFile), "..");
const workerDir = join(repoRoot, "worker");
const agentDir = join(repoRoot, "agent");
const deployDir = join(repoRoot, "deploy");
const privateDir = join(repoRoot, ".yuanshan");
const statePath = join(privateDir, "state.json");
const wranglerConfigPath = join(workerDir, "wrangler.jsonc");
const wranglerBin = join(workerDir, "node_modules", "wrangler", "bin", "wrangler.js");
const releaseRepository = process.env.YUANSHAN_RELEASE_REPOSITORY || "MostlyCodex/yuanshan-monitor";
const maxDownloadBytes = 64 * 1024 * 1024;

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
      TELEGRAM_BOT_USERNAME: botUsername || "yuanshan_monitor_bot",
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

export function createAgentConfig({ id, displayName, shortMark, role, region, displayOrder, endpoint, secret, services = [], probes = [] }) {
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
    if (required) fail("尚未初始化，请先运行 npm run setup");
    return null;
  }
  const info = await lstat(statePath);
  if (!info.isFile() || info.isSymbolicLink()) fail(".yuanshan/state.json 必须是普通文件，不能是符号链接");
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

function makePrompter() {
  const interface_ = createInterface({ input: process.stdin, output: process.stdout });
  return {
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
    line("远山Monitor 环境检查");
    for (const check of checks) line(`${check.ok ? "✓" : "✗"} ${check.name.padEnd(14)} ${check.detail}`);
    line("");
    line((await exists(statePath)) ? `本地部署状态：${statePath}` : "本地部署状态：尚未初始化");
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
  await secretPut("TELEGRAM_WEBHOOK_SECRET", state.telegram.webhookSecret);
  await secretPut("TELEGRAM_BIND_CODE_HASH", createHash("sha256").update(state.telegram.bindCode).digest("hex"));
  line("接下来由 Wrangler 安全读取 Telegram Bot Token；本工具不会保存或显示它。");
  await wrangler(["secret", "put", "TELEGRAM_BOT_TOKEN", "--config", wranglerConfigPath], { interactive: true });
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
      fail("检测到已有 worker/wrangler.jsonc，但没有 yuanshanctl 状态。为避免覆盖现有部署，setup 已停止；已有手工部署请继续按原文档管理。");
    }
    const defaultWorker = `yuanshan-monitor-${randomBytes(3).toString("hex")}`;
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
  line("应用 D1 migrations…");
  await wrangler(["d1", "migrations", "apply", state.databaseName, "--remote", "--config", wranglerConfigPath]);
  line("首次部署 Worker…");
  const deployed = await wrangler(["deploy", "--config", wranglerConfigPath], { capture: true, echo: true });
  const discoveredUrl = extractWorkerUrl(`${deployed.stdout}\n${deployed.stderr}`);
  if (!state.workerUrl && !discoveredUrl) fail("部署完成但未识别 workers.dev URL，请从 Wrangler 输出确认 URL 后重新运行 setup");
  if (discoveredUrl && discoveredUrl !== state.workerUrl) {
    state.workerUrl = discoveredUrl;
    await writePrivateJson(statePath, state);
    await writeWorkerConfig(state);
    line("写入最终面板 URL 并再次部署…");
    await wrangler(["deploy", "--config", wranglerConfigPath]);
  }
  await secretPut("NODE_KEYS", JSON.stringify(state.nodeKeys));
  await secretPut("ADMIN_TOKEN", state.adminToken);
  if (state.telegram && !state.telegram.configured) await configureTelegram(state);
  await verifyHealth(state.workerUrl);
  state.stage = "ready";
  await writePrivateJson(statePath, state);

  line("");
  line("后端部署完成。" );
  line(`面板：${state.workerUrl}/dashboard/`);
  if (state.telegram) {
    line(`请私聊 @${state.telegram.username} 发送：/bind ${state.telegram.bindCode}`);
    line("绑定后发送 /panel 打开面板。绑定成功后可从密码管理器删除一次性绑定码。" );
  }
  if (await prompt.yes("现在添加并安装首台 VPS", true)) await addNode(prompt);
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

async function addNode(prompt) {
  const state = await loadState();
  if (state.stage !== "ready") fail("后端尚未部署完成，请先重新运行 npm run setup");
  const id = (await prompt.text("节点 ID（小写，稳定且唯一）")).toLowerCase();
  if (!validateNodeId(id)) fail("节点 ID 必须匹配 [a-z0-9][a-z0-9_-]{0,31}");
  if (state.nodeKeys[id]) fail(`节点 ${id} 已存在；不会生成第二套同名密钥`);
  const displayName = await prompt.text("面板显示名", id);
  const role = await prompt.text("用途", "VPS");
  const region = await prompt.text("国家 / 城市", "unspecified");
  const shortMark = await prompt.text("1–4 位短标记", id.replace(/[-_]/g, "").slice(0, 3).toUpperCase());
  const units = await prompt.text("只读监测的 systemd 服务（逗号分隔，可留空）", "");
  const secret = randomSecret();
  const config = createAgentConfig({
    id,
    displayName,
    shortMark,
    role,
    region,
    displayOrder: (Object.keys(state.nodes).length + 1) * 10,
    endpoint: state.workerUrl,
    secret,
    services: parseServices(units),
  });
  state.nodeKeys[id] = secret;
  state.nodes[id] = { configPath: `.yuanshan/nodes/${id}/config.json`, sshTarget: "", installed: false };
  const configPath = join(privateDir, "nodes", id, "config.json");
  await writePrivateJson(configPath, config);
  await writePrivateJson(statePath, state);
  await secretPut("NODE_KEYS", JSON.stringify(state.nodeKeys));
  line(`✓ 已安全更新完整 NODE_KEYS（${Object.keys(state.nodeKeys).length} 个节点）`);
  line(`✓ 私密节点配置：${configPath}`);
  const target = await prompt.text("SSH 主机或 ~/.ssh/config 别名（留空则稍后安装）", "");
  if (target) await installNode(id, target);
  else line(`稍后安装：cd worker && npm run node:install -- ${id} --ssh <SSH别名>`);
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

async function obtainAgentBinary(version, architecture, outputPath) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(releaseRepository)) fail("YUANSHAN_RELEASE_REPOSITORY 必须使用 owner/repository 格式");
  const asset = `vpsmon-agent-linux-${architecture}`;
  const baseUrl = `https://github.com/${releaseRepository}/releases/download/v${version}`;
  try {
    const [binary, manifestBuffer] = await Promise.all([
      download(`${baseUrl}/${asset}`),
      download(`${baseUrl}/SHA256SUMS`),
    ]);
    const expected = parseReleaseChecksum(manifestBuffer.toString("utf8"), asset);
    const actual = createHash("sha256").update(binary).digest("hex");
    if (actual !== expected) fail("Agent SHA-256 校验失败，已停止安装，不会降级为源码构建");
    await writeFile(outputPath, binary, { mode: 0o700 });
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
    return "source";
  }
}

async function resolveRemoteArchitecture(target) {
  const result = await run("ssh", [target, "uname -m"], { capture: true });
  const architecture = result.stdout.trim().toLowerCase();
  if (["x86_64", "amd64"].includes(architecture)) return "amd64";
  if (["aarch64", "arm64"].includes(architecture)) return "arm64";
  fail(`暂不支持远端架构：${architecture || "未知"}`);
}

async function installNode(id, target) {
  if (!validateSshTarget(target)) fail("SSH 目标格式无效；复杂端口请写入 ~/.ssh/config 后使用别名");
  const state = await loadState();
  if (!state.nodes[id] || !state.nodeKeys[id]) fail(`本地状态中没有节点 ${id}`);
  const configPath = join(privateDir, "nodes", id, "config.json");
  if (!(await exists(configPath))) fail(`节点配置不存在：${configPath}`);
  const version = await readVersion();
  const architecture = await resolveRemoteArchitecture(target);
  line(`下载并校验远山Monitor v${version} linux/${architecture}…`);

  const localStage = await mkdtemp(join(tmpdir(), "yuanshan-stage-"));
  const remoteStage = `/tmp/vpsmon-stage.${randomBytes(8).toString("hex")}`;
  const payloads = ["vpsmon-agent", "config.json", "vpsmon-agent.service", "install-agent.sh"];
  try {
    await obtainAgentBinary(version, architecture, join(localStage, "vpsmon-agent"));
    await writeFile(join(localStage, "config.json"), await readFile(configPath), { mode: 0o600 });
    await writeFile(join(localStage, "vpsmon-agent.service"), await readFile(join(deployDir, "vpsmon-agent.service")), { mode: 0o644 });
    await writeFile(join(localStage, "install-agent.sh"), await readFile(join(deployDir, "install-agent.sh")), { mode: 0o700 });
    const checksums = [];
    for (const payload of payloads) {
      const digest = createHash("sha256").update(await readFile(join(localStage, payload))).digest("hex");
      checksums.push(`${digest}  ${payload}`);
    }
    await writeFile(join(localStage, "checksums.sha256"), `${checksums.join("\n")}\n`, { mode: 0o600 });

    line(`在 ${target} 创建受限临时目录并安装独立 Agent；若 sudo 需要密码，请在提示中输入。`);
    await run("ssh", [target, `umask 077 && mkdir ${remoteStage}`]);
    await run("scp", [...payloads.map((name) => join(localStage, name)), join(localStage, "checksums.sha256"), `${target}:${remoteStage}/`]);
    await run("ssh", [target, `chmod 700 ${remoteStage} ${remoteStage}/vpsmon-agent ${remoteStage}/install-agent.sh && chmod 600 ${remoteStage}/config.json ${remoteStage}/checksums.sha256 && chmod 644 ${remoteStage}/vpsmon-agent.service`]);
    await run("ssh", ["-t", target, `sudo sh ${remoteStage}/install-agent.sh ${remoteStage}`], { interactive: true });
    const active = await run("ssh", [target, "systemctl is-active vpsmon-agent.service"], { capture: true });
    if (active.stdout.trim() !== "active") fail("Agent 安装后未处于 active 状态");
    state.nodes[id].sshTarget = target;
    state.nodes[id].installed = true;
    await writePrivateJson(statePath, state);
    line(`✓ ${id} 已安装，通常会在 60 秒内出现在面板。`);
  } finally {
    await run("ssh", [target, `rm -rf -- ${remoteStage}`], { capture: true, allowFailure: true }).catch(() => {});
    await rm(localStage, { recursive: true, force: true });
  }
}

async function syncKeys() {
  const state = await loadState();
  await secretPut("NODE_KEYS", JSON.stringify(state.nodeKeys));
  line(`✓ 已提交完整 NODE_KEYS（${Object.keys(state.nodeKeys).length} 个节点），未显示任何密钥。`);
}

async function showStatus() {
  const state = await loadState(false);
  if (!state) {
    line("尚未初始化。运行：cd worker && npm ci && npm run setup");
    return;
  }
  line(`Worker  ${state.workerName}`);
  line(`D1      ${state.databaseName}`);
  line(`URL     ${state.workerUrl || "尚未部署"}`);
  line(`阶段    ${state.stage}`);
  line(`节点    ${Object.keys(state.nodes).length}`);
  for (const [id, node] of Object.entries(state.nodes)) {
    line(`  ${node.installed ? "✓" : "·"} ${id}${node.sshTarget ? `  (${node.sshTarget})` : ""}`);
  }
  if (state.workerUrl) await verifyHealth(state.workerUrl);
}

function usage() {
  line(`远山Monitor 部署管理工具

用法：
  node tools/yuanshanctl.mjs doctor
  node tools/yuanshanctl.mjs setup [--yes]
  node tools/yuanshanctl.mjs status
  node tools/yuanshanctl.mjs node add
  node tools/yuanshanctl.mjs node install <NODE_ID> --ssh <SSH别名>
  node tools/yuanshanctl.mjs node sync-keys

快捷入口（worker 目录）：npm run doctor / npm run setup / npm run node:add / npm run node:install

安全说明：Secret 只写入 Cloudflare 和 .yuanshan/ 私有目录；该目录已被 Git 忽略。`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "help";
  if (command === "help" || command === "--help" || command === "-h") return usage();
  if (command === "doctor") {
    if (!(await doctor())) process.exitCode = 1;
    return;
  }
  if (command === "status") return showStatus();
  const prompt = makePrompter();
  try {
    if (command === "setup") return await setup(prompt, args.includes("--yes"));
    if (command === "node" && args[1] === "add") return await addNode(prompt);
    if (command === "node" && args[1] === "sync-keys") return await syncKeys();
    if (command === "node" && args[1] === "install") {
      const id = args[2];
      const sshIndex = args.indexOf("--ssh");
      if (!id || sshIndex < 0 || !args[sshIndex + 1]) fail("用法：node install <NODE_ID> --ssh <SSH别名>");
      return await installNode(id, args[sshIndex + 1]);
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
