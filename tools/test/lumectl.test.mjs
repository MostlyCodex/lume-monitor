import assert from "node:assert/strict";
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
    version: "1.1.0",
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
  assert.equal(config.secret.length, 64);
});
