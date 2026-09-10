import { DATABASE_SCHEMA } from "../database.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import {
  assertRollbackVersion,
  workerVersion,
  currentWorkerVersion,
  waitForLiveReports,
  rollbackSafely,
} from "../worker-rollback.mjs";

test("rollback requires a version and matching database identity", () => {
  const metadata = (version, schema) => ({
    resources: {
      bindings: [
        { type: "plain_text", name: "APP_VERSION", text: version },
        { type: "plain_text", name: "DATABASE_SCHEMA", text: schema },
      ],
    },
  });
  assertRollbackVersion(metadata("1.1.0", DATABASE_SCHEMA));
  for (const candidate of [
    undefined,
    metadata(undefined, DATABASE_SCHEMA),
    metadata("1.1.0", undefined),
    metadata("1.1.0", "different"),
  ])
    assert.throws(() => assertRollbackVersion(candidate), /未执行回滚/);
  assert.equal(workerVersion(metadata("1.1.0", DATABASE_SCHEMA)), "1.1.0");
});

test("the active deployment is selected by timestamp and split traffic is rejected", () => {
  const single = {
    created_on: "2026-09-10",
    versions: [{ version_id: "new", percentage: 100 }],
  };
  assert.equal(
    currentWorkerVersion([single, { created_on: "2026-09-09", versions: [] }]),
    "new",
  );
  assert.throws(
    () =>
      currentWorkerVersion([
        { ...single, versions: [{ percentage: 50 }, { percentage: 50 }] },
      ]),
    /全部流量/,
  );
});

const sample = () => ({
  health: { ok: true, version: "1.1.0", database_schema: DATABASE_SCHEMA },
  dashboard: {
    app_version: "1.1.0",
    nodes: [{ id: "public-a", online: true, reported_at: 102 }],
  },
  inventory: {
    nodes: [
      {
        node_id: "node-a",
        enabled: true,
        generated_at: 102,
        last_report_at: 103,
      },
    ],
  },
});
const targets = [
  { node_id: "node-a", public_id: "public-a", generated_at: 99 },
];
async function wait(read, selected = targets) {
  let time = 0;
  return waitForLiveReports({
    read,
    targets: selected,
    version: "1.1.0",
    since: 100,
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
    timeoutMs: 15_000,
  });
}
test("rollback verification requires fresh generated reports and matching dashboard data", async () => {
  await wait(async () => sample());
  for (const change of [
    (value) => {
      value.health.version = "old";
    },
    (value) => {
      value.dashboard.nodes = [];
    },
    (value) => {
      value.dashboard.nodes[0].reported_at = 99;
    },
    (value) => {
      value.dashboard.nodes[0].data_error = true;
    },
    (value) => {
      value.inventory.nodes[0].generated_at = 99;
    },
    (value) => {
      value.inventory.nodes[0].enabled = false;
    },
    (value) => {
      value.inventory.nodes[0].last_report_at = 99;
    },
  ]) {
    const value = sample();
    change(value);
    await assert.rejects(
      wait(async () => value),
      /未通过验证/,
    );
  }
  await assert.rejects(
    wait(
      async () => sample(),
      [...targets, { node_id: "missing", public_id: "missing" }],
    ),
    /missing/,
  );
  await assert.rejects(
    wait(async () => {
      throw Error("network failed");
    }),
    /未通过验证/,
  );
  let calls = 0;
  await wait(async () => {
    if (!calls++) throw Error("transient");
    return sample();
  });
});

test("failed rollback restores and verifies the original version, without claiming success", async () => {
  for (const failure of [null, "rollback", "verify", "verifyRestored"]) {
    const calls = [];
    const action = (name) => async () => {
      calls.push(name);
      if (
        name === failure ||
        (failure === "verifyRestored" && name === "verify")
      )
        throw Error(name);
    };
    const work = rollbackSafely(
      Object.fromEntries(
        ["rollback", "verify", "restore", "verifyRestored"].map((name) => [
          name,
          action(name),
        ]),
      ),
    );
    if (failure)
      await assert.rejects(
        work,
        failure === "verifyRestored" ? /恢复也未通过/ : /已恢复原/,
      );
    else await work;
    assert.deepEqual(
      calls,
      failure === "rollback"
        ? ["rollback", "restore", "verifyRestored"]
        : failure
          ? ["rollback", "verify", "restore", "verifyRestored"]
          : ["rollback", "verify"],
    );
  }
});

test("management rejects a mismatched Worker before deployment or confirmation", async () => {
  const source = await readFile(
    new URL("../lumectl.mjs", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("async function rollbackWorker(");
  const code = source.slice(
    start,
    source.indexOf("async function findOrCreateDatabase", start),
  );
  const calls = [];
  const context = vm.createContext({
    workerVersion,
    currentWorkerVersion,
    assertRollbackVersion,
    loadState: async () => ({
      adminToken: "fixture",
      workerUrl: "https://fixture.example",
    }),
    ensureCloudflareLogin: async () => {},
    wranglerConfigPath: "fixture.jsonc",
    wrangler: async (args) => {
      calls.push(args[0] + " " + args[1]);
      return {
        stdout: JSON.stringify({
          resources: {
            bindings: [
              { type: "plain_text", name: "APP_VERSION", text: "1.0.0" },
            ],
          },
        }),
      };
    },
    prepareWorkerDatabase: async () => {
      calls.push("read-schema");
    },
    fail: (message) => {
      throw Error(message);
    },
  });
  new vm.Script(code).runInContext(context);
  await assert.rejects(
    context.rollbackWorker(
      {
        yes: () => {
          throw Error("must not ask");
        },
      },
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      new Map(),
    ),
    /结构标识/,
  );
  assert.deepEqual(calls, ["versions view"]);
});
