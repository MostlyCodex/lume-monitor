import { testPermanentDeletion } from "./node-deletion-integration.mjs";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const workerDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = join(workerDirectory, "node_modules", "wrangler", "bin", "wrangler.js");
const temporaryRoot = await mkdtemp(join(tmpdir(), "lume-worker-integration-"));
const wranglerEnvironment = {
  ...process.env,
  WRANGLER_LOG_PATH: join(temporaryRoot, "wrangler.log"),
  XDG_CONFIG_HOME: join(temporaryRoot, "wrangler-config"),
};

function runWrangler(arguments_, capture = false) {
  const result = spawnSync(process.execPath, [wrangler, ...arguments_], {
    cwd: workerDirectory,
    env: wranglerEnvironment,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });
  if (result.status !== 0) {
    const details = capture ? `${result.stdout ?? ""}\n${result.stderr ?? ""}` : "";
    throw new Error(`wrangler ${arguments_.join(" ")} failed (${result.status})\n${details}`);
  }
  return result.stdout ?? "";
}

async function unusedPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForWorker(url, child, output) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`wrangler dev exited before becoming healthy\n${output.join("")}`);
    }
    try {
      const response = await fetch(`${url}/healthz`);
      if (response.ok) return;
    } catch {
      // Wrangler has not opened the port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`wrangler dev did not become healthy\n${output.join("")}`);
}

async function stopWorker(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
  }
}

function query(config, persistence, sql, all = false) {
  const raw = runWrangler([
    "d1", "execute", "DB", "--local", "--config", config,
    "--persist-to", persistence, "--command", sql, "--json",
  ], true);
  const results = JSON.parse(raw);
  return all ? results : results[0]?.results ?? [];
}

function testProductionUpgrade(root) {
  const persistence = join(root, "upgrade");
  const config = "wrangler.upgrade-test.jsonc";
  runWrangler([
    "d1", "execute", "DB", "--local", "--config", config, "--persist-to", persistence,
    "--file", "test/fixtures/v3-before-0006.sql", "--yes",
  ], true);
  runWrangler([
    "d1", "execute", "DB", "--local", "--config", config, "--persist-to", persistence,
    "--command", "UPDATE node_latest SET report_json=json_object('node',json_object('id','legacy-fixture','display_name','Legacy Fixture','short_mark','OLD'),'keep',42); " +
      "UPDATE snapshots SET report_json=(SELECT report_json FROM node_latest WHERE node_id='legacy-fixture');", "--yes",
  ], true);
  runWrangler([
    "d1", "migrations", "apply", "DB", "--local", "--config", config,
    "--persist-to", persistence,
  ], true);
  const preserved = query(
    config,
    persistence,
    "SELECT display_name, offline_severity, ip_change_severity, enabled FROM node_catalog WHERE node_id='legacy-fixture'",
  );
  if (
    preserved.length !== 1 ||
    preserved[0].display_name !== "Legacy Fixture" ||
    preserved[0].offline_severity !== "P1" ||
    preserved[0].ip_change_severity !== "P2" ||
    preserved[0].enabled !== 0
  ) {
    throw new Error(`legacy node was not preserved correctly: ${JSON.stringify(preserved)}`);
  }

  const directory = query(
    config,
    persistence,
    "SELECT catalog.retired_at, latest.received_at FROM node_catalog AS catalog " +
      "LEFT JOIN node_latest AS latest ON latest.node_id = catalog.node_id WHERE catalog.node_id='legacy-fixture'",
  );
  if (directory.length !== 1 || directory[0].retired_at !== null) {
    throw new Error("upgraded node directory must be readable and preserve the existing node without retiring it");
  }

  const latest = query(
    config,
    persistence,
    "SELECT last_boot_id, recent_nonces_json FROM node_latest WHERE node_id='legacy-fixture'",
  );
  if (latest.length !== 1 || latest[0].last_boot_id !== "legacy-boot-id" || latest[0].recent_nonces_json !== "[]") {
    throw new Error(`legacy latest state was not preserved correctly: ${JSON.stringify(latest)}`);
  }

  const invalidKinds = query(config, persistence, "SELECT COUNT(*) AS count FROM probe_catalog WHERE kind NOT IN ('icmp','tcp')");
  if (Number(invalidKinds[0]?.count) !== 0) {
    throw new Error(`obsolete probe kinds survived the upgrade: ${JSON.stringify(invalidKinds)}`);
  }
  const columns=query(config,persistence,"PRAGMA table_info(node_catalog)").map(column=>column.name);
  if (columns.includes("short_mark")) throw new Error("obsolete node column survived upgrade");
  const indexes=query(config,persistence,"SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='node_catalog'").map(row=>row.name);
  if (!indexes.includes("idx_node_catalog_order")) throw new Error("catalog index lost during upgrade");
  for (const table of ["node_latest","snapshots"]) {
    const rows=query(config,persistence,`SELECT report_json FROM ${table} WHERE node_id='legacy-fixture'`);
    if (rows.length!==1) throw new Error("historical report lost");
    const report=JSON.parse(rows[0].report_json);
    if (report.node.id!=="legacy-fixture" || report.node.display_name!=="Legacy Fixture" || Object.hasOwn(report.node,"short_mark") || report.keep!==42) throw new Error("historical metadata migration failed");
  }
  console.log("production_upgrade_ok=true");
}

async function testFreshDatabase(root) {
  const persistence = join(root, "fresh");
  const config = "wrangler.test.jsonc";
  runWrangler([
    "d1", "migrations", "apply", "DB", "--local", "--config", config,
    "--persist-to", persistence,
  ], true);
  runWrangler([
    "d1", "execute", "DB", "--local", "--config", config, "--persist-to", persistence,
    "--command",
    "INSERT INTO metric_samples_v3 VALUES (1,'expired-fixture',1,'expired-boot',0,0,0,0,0,0,0,0,0,0,NULL,NULL,0,0,0,0,'[]'); " +
      "INSERT INTO probe_rounds_v3 VALUES (1,'expired-fixture',1,'[]');",
    "--yes",
  ], true);

  const port = await unusedPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const output = [];
  const child = spawn(process.execPath, [
    wrangler, "dev", "--local", "--config", config, "--persist-to", persistence,
    "--ip", "127.0.0.1", "--port", String(port), "--test-scheduled",
    "--show-interactive-dev-session", "false", "--log-level", "warn",
  ], { cwd: workerDirectory, env: wranglerEnvironment, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));

  try {
    await waitForWorker(baseUrl, child, output);
    const result = spawnSync(process.execPath, ["test/integration.mjs"], {
      cwd: workerDirectory,
      env: { ...process.env, VPSMON_TEST_URL: baseUrl },
      encoding: "utf8",
      stdio: "pipe",
    });
    if (result.status !== 0) {
      throw new Error(`HTTP integration failed\n${result.stdout}\n${result.stderr}\n${output.join("")}`);
    }
    process.stdout.write(result.stdout);
    await testPermanentDeletion({baseUrl,query:(sql,all)=>query(config,persistence,sql,all)});
  } finally {
    await stopWorker(child);
  }

  const expired = query(
    config,
    persistence,
    "SELECT " +
      "(SELECT COUNT(*) FROM metric_samples_v3 WHERE node_id='expired-fixture') AS metrics, " +
      "(SELECT COUNT(*) FROM probe_rounds_v3 WHERE node_id='expired-fixture') AS probes",
  );
  if (Number(expired[0]?.metrics) !== 0 || Number(expired[0]?.probes) !== 0) {
    throw new Error(`scheduled retention did not remove expired raw rows: ${JSON.stringify(expired)}`);
  }
  const rollups = query(
    config,
    persistence,
    "SELECT " +
      "(SELECT COUNT(*) FROM metric_series_rollups) AS metrics, " +
      "(SELECT COUNT(*) FROM probe_series_rollups) AS probes",
  );
  if (Number(rollups[0]?.metrics) === 0 || Number(rollups[0]?.probes) === 0) {
    throw new Error(`observability rebuild did not create rollups: ${JSON.stringify(rollups)}`);
  }
  console.log("retention_and_rollups_ok=true");
}

function workflowEscape(value) {
  return value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

async function main() {
  try {
    testProductionUpgrade(temporaryRoot);
    await testFreshDatabase(temporaryRoot);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
}

try {
  await main();
} catch (error) {
  const detail = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(detail);
  if (process.env.GITHUB_ACTIONS === "true") {
    console.error(`::error title=Local Wrangler integration failed::${workflowEscape(detail)}`);
  }
  process.exitCode = 1;
}
