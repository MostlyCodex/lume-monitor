import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { localRuntime } from "./local-runtime.mjs";
import { prepareDatabase } from "../../tools/database.mjs";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const execute = (command, args, cwd) =>
  execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

// Exercise the actual Linux collector and binary against the current Worker
// and an empty D1. No historical source snapshots or reconstructed reports.
export async function testAgentReport() {
  if (process.platform !== "linux") {
    console.log("real_agent_report=requires_linux (CI runs this test)");
    return;
  }
  const root = await mkdtemp(join(tmpdir(), "lume-agent-report-"));
  const runtime = await localRuntime();
  try {
    const { version } = JSON.parse(
      await readFile(join(repository, "worker/package.json"), "utf8"),
    );
    const binary = join(root, "agent");
    execute(
      "go",
      [
        "build",
        "-trimpath",
        "-ldflags=-X main.version=" + version,
        "-o",
        binary,
        "./cmd/vpsmon-agent",
      ],
      join(repository, "agent"),
    );
    const config = {
      node: { id: "alpha-vps", display_name: "Agent fixture" },
      endpoint: "https://fixture.example/api/v1/report",
      secret: "a".repeat(32),
      report_interval_seconds: 60,
      probe_interval_seconds: 60,
      services: [],
      probes: [],
      traffic_cycle: { enabled: false },
      spool_path:
        "/var/lib/vpsmon/report-test-" +
        randomBytes(8).toString("hex") +
        "/pending.json",
    };
    const configPath = join(root, "config.json");
    await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
    const report = JSON.parse(
      execute(binary, ["--config", configPath, "--dry-run"], root),
    );
    assert.equal(report.agent_version, version);
    await prepareDatabase({ query: runtime.query });
    await runtime.worker(join(repository, "worker/src/index.ts"), version);
    const body = JSON.stringify(report);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(16).toString("hex");
    const signature = createHmac("sha256", config.secret)
      .update(timestamp + "\n" + nonce + "\n" + body)
      .digest("hex");
    const response = await runtime.fetch("/api/v1/report", {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        "X-Vpsmon-Node": config.node.id,
        "X-Vpsmon-Timestamp": timestamp,
        "X-Vpsmon-Nonce": nonce,
        "X-Vpsmon-Signature": "sha256=" + signature,
      },
    });
    assert.equal(response.status, 202, await response.text());
    const auth = {
      headers: { authorization: "Bearer local-admin-token-with-32-characters" },
    };
    const dashboard = await runtime.fetch("/api/v1/dashboard/latest", auth);
    assert.equal(dashboard.status, 200);
    const card = (await dashboard.json()).nodes.find(
      (node) => node.id === config.node.id,
    );
    assert.equal(card.reported_at, report.generated_at);
    const stored = await runtime.query(
      "SELECT report_json FROM node_latest WHERE node_id='alpha-vps'",
    );
    assert.equal(JSON.parse(stored[0].report_json).agent_version, version);
    const history = await runtime.fetch(
      "/api/v1/dashboard/history?hours=24&node=alpha-vps",
      auth,
    );
    assert.equal(history.status, 200, await history.text());
    console.log("current_agent_worker_report_and_history_ok=true");
  } finally {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
}
if (process.argv[1]?.endsWith("agent-report-integration.mjs"))
  await testAgentReport();
