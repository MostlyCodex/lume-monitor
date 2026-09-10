import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { localRuntime } from "./local-runtime.mjs";
import { prepareDatabase, cleanDatabase } from "../../tools/database.mjs";
import { assertRollbackVersion } from "../../tools/worker-rollback.mjs";

// Immutable source revisions; no copied legacy implementation is maintained.
const previous = [
  ["1.0.0", "ffd57ec50138a30a5fb692fee1d1b00f76cf1fa5"],
  ["1.0.1", "1479ecc73ee0a9dea2ed7a446050b2c1a31e04b5"],
  ["1.0.2", "9ff1e3eb9226ac5da4674be168a5b87ccbe0832a"],
];
const repository = fileURLToPath(new URL("../../", import.meta.url));
const execute = (command, args, cwd) =>
  execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

export async function testVersionCompatibility() {
  if (process.platform !== "linux") {
    console.log("real_agent_version_matrix=requires_linux (CI runs this test)");
    return;
  }
  const root = await mkdtemp(join(tmpdir(), "lume-version-matrix-"));
  const runtime = await localRuntime();
  try {
    const sources = [];
    for (const [version, revision] of previous) {
      const folder = join(root, version);
      await mkdir(folder);
      execute(
        "git",
        [
          "archive",
          "--format=tar",
          "--output=" + join(folder, "source.tar"),
          revision,
          "worker/src",
          "agent",
        ],
        repository,
      );
      execute("tar", ["-xf", join(folder, "source.tar"), "-C", folder], root);
      sources.push({ version, folder });
    }
    sources.push({ version: "1.0.3", folder: repository });
    for (const source of sources) {
      const binary = join(root, "agent-" + source.version);
      execute(
        "go",
        [
          "build",
          "-trimpath",
          "-ldflags=-X main.version=" + source.version,
          "-o",
          binary,
          "./cmd/vpsmon-agent",
        ],
        join(source.folder, "agent"),
      );
      const config = {
        node: {
          id: "alpha-vps",
          display_name: "Compatibility fixture",
          ...(source.version === "1.0.0" ? { short_mark: "TEST" } : {}),
        },
        endpoint: "https://fixture.example/api/v1/report",
        secret: "a".repeat(32),
        report_interval_seconds: 60,
        probe_interval_seconds: 60,
        services: [],
        probes: [],
        traffic_cycle: { enabled: false },
        spool_path:
          "/var/lib/vpsmon/compatibility-" +
          randomBytes(8).toString("hex") +
          "/pending.json",
      };
      const path = join(root, "config-" + source.version + ".json");
      await writeFile(path, JSON.stringify(config), { mode: 0o600 });
      await chmod(path, 0o600);
      // Run the actual binary and collector, not a reconstructed report model.
      source.report = JSON.parse(
        execute(binary, ["--config", path, "--dry-run"], root),
      );
      assert.equal(source.report.agent_version, source.version);
      assert.equal(
        Object.hasOwn(source.report.node, "short_mark"),
        source.version === "1.0.0",
      );
    }
    await prepareDatabase({ query: runtime.query });
    let generated = Math.floor(Date.now() / 1000) - 120;
    const submit = async (source, status = 202) => {
      const report = { ...source.report, generated_at: ++generated };
      const body = JSON.stringify(report);
      const timestamp = String(Math.floor(Date.now() / 1000));
      const nonce = randomBytes(16).toString("hex");
      const signature = createHmac("sha256", "a".repeat(32))
        .update(timestamp + "\n" + nonce + "\n" + body)
        .digest("hex");
      const response = await runtime.fetch("/api/v1/report", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Vpsmon-Node": "alpha-vps",
          "X-Vpsmon-Timestamp": timestamp,
          "X-Vpsmon-Nonce": nonce,
          "X-Vpsmon-Signature": "sha256=" + signature,
        },
        body,
      });
      assert.equal(
        response.status,
        status,
        source.version + ": " + (await response.text()),
      );
      if (status === 202) {
        const response = await runtime.fetch("/api/v1/dashboard/latest", {
          headers: {
            authorization: "Bearer local-admin-token-with-32-characters",
          },
        });
        assert.equal(response.status, 200);
        const dashboard = await response.json();
        assert.equal(
          dashboard.nodes.find((node) => node.id === "alpha-vps").reported_at,
          generated,
        );
        assert.equal(
          JSON.parse(
            (
              await runtime.query(
                "SELECT report_json FROM node_latest WHERE node_id='alpha-vps'",
              )
            )[0].report_json,
          ).agent_version,
          source.version,
        );
      }
    };
    const switchWorker = (source) =>
      runtime.worker(
        resolve(source.folder, "worker/src/index.ts"),
        source.version,
      );
    // Before cleanup: old code must still work during compatible DB updates.
    await switchWorker(sources[0]);
    await submit(sources[0]);
    await submit(sources.at(-1), 400);
    await switchWorker(sources.at(-1));
    for (const source of sources) await submit(source);
    await cleanDatabase({ query: runtime.query });
    // After cleanup: mixed old/new Agents work with each allowed rollback Worker.
    for (const worker of sources.slice(1)) {
      assertRollbackVersion(worker.version, []);
      await switchWorker(worker);
      for (const agent of sources) await submit(agent);
      console.log(
        "version_matrix_worker=" +
          worker.version +
          " agents=" +
          sources.map((source) => source.version).join(","),
      );
    }
    assert.throws(() => assertRollbackVersion("1.0.0", []), /上报格式/);
    // Counterexample: restoring storage alone never repairs protocol compatibility.
    await runtime.query(
      "ALTER TABLE node_catalog ADD COLUMN short_mark TEXT NOT NULL DEFAULT 'TEST';",
    );
    await switchWorker(sources[0]);
    await submit(sources[0]);
    await submit(sources.at(-1), 400);
    console.log("legacy_worker_protocol_counterexample_ok=true");
  } finally {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1]?.endsWith("version-compatibility.mjs"))
  await testVersionCompatibility();
