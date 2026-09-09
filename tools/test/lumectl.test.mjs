import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createAgentConfig,
  createWranglerConfig,
  normalizeArchitecture,
  normalizeNodeSpec,
  parseD1List,
  parseFlags,
  parseReleaseChecksum,
  validateDatabaseName,
  validateNodeId,
  validateSshTarget,
  validateWorkerName,
} from "../lumectl.mjs";

test("deployment identifiers reject shell syntax and unstable forms", () => {
  assert.equal(validateWorkerName("lume-monitor-a1b2c3"), true);
  assert.equal(validateWorkerName("Lume"), false);
  assert.equal(validateWorkerName("monitor;whoami"), false);
  assert.equal(validateDatabaseName("lume_monitor-db"), true);
  assert.equal(validateDatabaseName("monitor db"), false);
  assert.equal(validateNodeId("tokyo-edge_01"), true);
  assert.equal(validateNodeId("Tokyo Edge"), false);
  assert.equal(validateSshTarget("ops@tokyo-edge"), true);
  assert.equal(validateSshTarget("host;touch bad"), false);
  assert.equal(validateSshTarget("-oProxyCommand=bad"), false);
});

test("D1 JSON parser accepts Wrangler UUID variants", () => {
  assert.deepEqual(parseD1List('[{"uuid":"1111","name":"monitor-db"}]'), [{ name: "monitor-db", id: "1111" }]);
  assert.deepEqual(parseD1List('\u001b[32m[{"database_id":"2222","name":"other"}]\u001b[0m'), [{ name: "other", id: "2222" }]);
});

test("release checksum parser matches the exact asset only", () => {
  const digest = "a".repeat(64);
  const manifest = `${"b".repeat(64)}  vpsmon-agent-linux-arm64\n${digest}  vpsmon-agent-linux-amd64\n`;
  assert.equal(parseReleaseChecksum(manifest, "vpsmon-agent-linux-amd64"), digest);
  assert.throws(() => parseReleaseChecksum(manifest, "vpsmon-agent-linux-amd"), /没有/);
});

test("generated Worker config contains only generic deployment values", () => {
  const config = createWranglerConfig({
    workerName: "lume-monitor-demo",
    databaseName: "lume-monitor-demo-db",
    databaseId: "00000000-0000-0000-0000-000000000000",
    dashboardUrl: "https://lume-monitor-demo.example.workers.dev",
    botUsername: "demo_monitor_bot",
    version: "1.2.0",
  });
  assert.equal(config.name, "lume-monitor-demo");
  assert.equal(config.d1_databases[0].binding, "DB");
  assert.equal(config.vars.DASHBOARD_BASE_URL, "https://lume-monitor-demo.example.workers.dev");
  assert.equal(JSON.stringify(config).includes("secret"), false);
});

test("generated Agent config is pure-host monitoring by default", () => {
  const config = createAgentConfig({
    id: "tokyo-edge",
    displayName: "Tokyo Edge",
    shortMark: "TYO",
    role: "线路中转",
    region: "JP / Tokyo",
    displayOrder: 10,
    endpoint: "https://monitor.example.workers.dev/",
    secret: "c".repeat(64),
  });
  assert.equal(config.endpoint, "https://monitor.example.workers.dev/api/v1/report");
  assert.equal(config.report_interval_seconds, 60);
  assert.deepEqual(config.services, []);
  assert.deepEqual(config.probes, []);
  assert.deepEqual(config.nftables_counters, []);
  assert.equal(config.secret.length, 64);
});

test("generated Agent config composes optional observers without private defaults", () => {
  const tcpProbe = {
    name: "peer_tcp",
    label: "Peer TCP",
    category: "node-link",
    target_node_id: "peer-node",
    kind: "tcp",
    target: "peer.example",
    port: 443,
    samples: 3,
  };
  const nftCounter = {
    name: "forward_hits",
    label: "Forward hits",
    family: "inet",
    table: "filter",
    chain: "forward",
    protocol: "tcp",
    destination_port: 443,
  };
  const config = createAgentConfig({
    id: "tokyo-edge",
    endpoint: "https://monitor.example.workers.dev",
    secret: "d".repeat(64),
    probes: [tcpProbe],
    nftablesCounters: [nftCounter],
  });
  assert.deepEqual(config.probes, [tcpProbe]);
  assert.deepEqual(config.nftables_counters, [nftCounter]);
});

test("nftables snapshot helper is short-lived and does not run as root", async () => {
  const unit = await readFile(new URL("../../deploy/vpsmon-nftables-snapshot.service", import.meta.url), "utf8");
  assert.match(unit, /^Type=oneshot$/m);
  assert.match(unit, /^User=vpsmon$/m);
  assert.match(unit, /^NoNewPrivileges=true$/m);
  assert.match(unit, /^CapabilityBoundingSet=CAP_NET_ADMIN$/m);
  assert.match(unit, /^AmbientCapabilities=CAP_NET_ADMIN$/m);
  assert.doesNotMatch(unit, /^User=root$/m);
});

test("fresh install creates the nftables snapshot state directory before starting the helper", async () => {
  const installer = await readFile(new URL("../../deploy/install-agent.sh", import.meta.url), "utf8");
  const createStateDirectory = installer.indexOf("install -d -o vpsmon -g vpsmon -m 0700 /var/lib/vpsmon");
  const startSnapshotHelper = installer.indexOf("systemctl start vpsmon-nftables-snapshot.service");
  assert.ok(createStateDirectory >= 0);
  assert.ok(startSnapshotHelper > createStateDirectory);
});

test("flag parser accepts both spaced and inline values without swallowing flags", () => {
  const { flags, positional } = parseFlags(["node", "add", "--id", "hk-01", "--name=HK 01", "--yes", "--ssh", "hk"]);
  assert.deepEqual(positional, ["node", "add"]);
  assert.equal(flags.get("id"), "hk-01");
  assert.equal(flags.get("name"), "HK 01");
  assert.equal(flags.get("yes"), true);
  assert.equal(flags.get("ssh"), "hk");
});

test("valueless flags before another flag stay boolean", () => {
  const { flags } = parseFlags(["node", "remove", "edge-01", "--uninstall", "--yes"]);
  assert.equal(flags.get("uninstall"), true);
  assert.equal(flags.get("yes"), true);
});

test("node specifications fill safe defaults and reject unusable input", () => {
  const spec = normalizeNodeSpec({ id: "HK-01", ssh: "hk-01", services: ["nftables.service"] });
  assert.equal(spec.id, "hk-01");
  assert.equal(spec.displayName, "hk-01");
  assert.equal(spec.role, "VPS");
  assert.equal(spec.shortMark, "HK0");
  assert.equal(spec.services, "nftables.service");
  assert.throws(() => normalizeNodeSpec({ id: "Bad Id" }), /节点 ID 无效/);
  assert.throws(() => normalizeNodeSpec({ id: "hk-01", ssh: "-oProxyCommand=bad" }), /SSH 目标格式无效/);
});

test("remote architecture mapping refuses anything it cannot ship a binary for", () => {
  assert.equal(normalizeArchitecture("x86_64"), "amd64");
  assert.equal(normalizeArchitecture("aarch64"), "arm64");
  assert.throws(() => normalizeArchitecture("riscv64"), /暂不支持远端架构/);
  assert.throws(() => normalizeArchitecture(""), /暂不支持远端架构/);
});

test("secrets are submitted in one bulk request rather than one deploy per secret", async () => {
  const tool = await readFile(new URL("../lumectl.mjs", import.meta.url), "utf8");
  assert.match(tool, /"secret", "bulk", "--config", wranglerConfigPath/);
  // Only the Telegram bot token still uses an interactive single put, so that
  // the token never passes through this tool.
  const singlePuts = tool.match(/"secret", "put"/g) ?? [];
  assert.equal(singlePuts.length, 2);
});

test("installing a node uses one connection to read the architecture and stage", async () => {
  const tool = await readFile(new URL("../lumectl.mjs", import.meta.url), "utf8");
  assert.match(tool, /uname -m && umask 077 && mkdir -m 700/);
  // The stage directory is created 0700 before anything is copied into it.
  assert.doesNotMatch(tool, /scp[\s\S]{0,400}?mkdir -m 700/);
});

test("uninstall keeps recoverable state and never touches monitored services", async () => {
  const uninstaller = await readFile(new URL("../../deploy/uninstall-agent.sh", import.meta.url), "utf8");
  assert.match(uninstaller, /vpsmon-agent\.service/);
  assert.doesNotMatch(uninstaller, /nft\s+(add|delete|flush)/);
  assert.doesNotMatch(uninstaller, /userdel/);
});
