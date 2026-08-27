import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createAgentConfig,
  createWranglerConfig,
  parseD1List,
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
