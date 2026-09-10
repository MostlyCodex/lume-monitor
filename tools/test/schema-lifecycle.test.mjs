import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import {
  deployInPhases,
  nodeIdentityCleanupSQL,
  nodeIdentityRollbackSQL,
  rollbackWithSchema,
} from "../schema-lifecycle.mjs";
import { createAgentConfig } from "../lumectl.mjs";

const source = await readFile(
  new URL("../lumectl.mjs", import.meta.url),
  "utf8",
);
function procedure(name) {
  const start = source.indexOf(`async function ${name}(`);
  assert.ok(start >= 0);
  const remaining = source.slice(start);
  const next = remaining.slice(1).search(/\n(?:async )?function /);
  return next < 0 ? remaining : remaining.slice(0, next + 1);
}

test("Worker deployment contracts only after compatible migrations, deployment and live verification", async () => {
  for (const failure of [null, "expand", "deploy", "verify", "contract"]) {
    const calls = [];
    const step = (name) => async () => {
      calls.push(name);
      if (failure === name) throw Error(name);
      return { stdout: "https://monitor.example", stderr: "" };
    };
    const context = vm.createContext({
      deployInPhases,
      readVersion: async () => "test-version",
      wranglerConfigPath: "wrangler.jsonc",
      applyDatabaseMigrations: step("expand"),
      wrangler: async (args) => {
        assert.ok(args.includes("--keep-vars"));
        assert.ok(args.includes("APP_VERSION:test-version"));
        return step("deploy")();
      },
      extractWorkerUrl: (value) => value.trim(),
      verifyDeployedWorker: async (url, version) => {
        assert.equal(url, "https://monitor.example");
        assert.equal(version, "test-version");
        await step("verify")();
      },
      contractNodeIdentity: step("contract"),
    });
    new vm.Script(procedure("deployWorker")).runInContext(context);
    if (failure)
      await assert.rejects(context.deployWorker({}), new RegExp(failure));
    else await context.deployWorker({});
    const stages = ["expand", "deploy", "verify", "contract"];
    assert.deepEqual(
      calls,
      failure ? stages.slice(0, stages.indexOf(failure) + 1) : stages,
    );
  }
});

test("live verification rejects an old version, incompatible schema or unreachable Worker", async () => {
  for (const health of [
    { ok: true, version: "old", node_identity_schema: 2 },
    { ok: true, version: "new" },
    null,
  ]) {
    let time = 0;
    const context = vm.createContext({
      Date: { now: () => time },
      AbortSignal,
      fetch: async () => {
        if (!health) throw Error("unreachable");
        return { ok: true, json: async () => health };
      },
      sleep: async (ms) => {
        time += ms;
      },
      fail: (message) => {
        throw Error(message);
      },
    });
    new vm.Script(procedure("verifyDeployedWorker")).runInContext(context);
    await assert.rejects(
      context.verifyDeployedWorker("https://monitor.example", "new"),
      /旧字段保留/,
    );
  }
});

test("contract SQL is repeatable when a previous deployment already removed the column", async () => {
  const sql = await readFile(
    new URL(
      "../../worker/migrations-contract/0007_node_identity.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    nodeIdentityCleanupSQL(sql, ["short_mark"], "0007_node_identity.sql"),
    /DROP COLUMN/,
  );
  const retry = nodeIdentityCleanupSQL(sql, [], "0007_node_identity.sql");
  assert.doesNotMatch(retry, /DROP COLUMN/);
  assert.match(retry, /json_remove/);
  assert.match(retry, /INSERT OR IGNORE INTO d1_migrations/);
  assert.throws(() =>
    nodeIdentityCleanupSQL(sql, [], "0007_node_identity.sql", "invalid;DROP"),
  );
  assert.match(nodeIdentityRollbackSQL([]), /ADD COLUMN/);
  assert.doesNotMatch(nodeIdentityRollbackSQL(["short_mark"]), /ADD COLUMN/);
});

test("rollback stops before changing code if preparing its schema fails", async () => {
  for (const failure of [null, "prepare", "rollback"]) {
    const calls = [];
    const steps = Object.fromEntries(
      ["prepare", "rollback", "verify"].map((name) => [
        name,
        async () => {
          calls.push(name);
          if (failure === name) throw Error(name);
        },
      ]),
    );
    if (failure)
      await assert.rejects(rollbackWithSchema(steps), new RegExp(failure));
    else await rollbackWithSchema(steps);
    assert.deepEqual(
      calls,
      failure === "prepare"
        ? ["prepare"]
        : failure === "rollback"
          ? ["prepare", "rollback"]
          : ["prepare", "rollback", "verify"],
    );
  }
});

test("node add upgrades a missing inventory endpoint before keys or files are changed", async () => {
  for (const status of [200, 404, 401, 500]) {
    for (const failedUpgrade of status === 404 ? [false, true] : [false]) {
      const calls = [];
      let updated = false;
      const state = {
        workerUrl: "https://monitor.example",
        nodes: {},
        nodeKeys: {},
      };
      const context = vm.createContext({
        Object,
        join,
        createAgentConfig,
        privateDir: "memory",
        privateDirName: ".lume",
        statePath: "memory/state.json",
        line: () => {},
        fail: (message) => {
          throw Error(message);
        },
        adminFetch: async () => {
          calls.push("inventory");
          return updated || status === 200
            ? { ok: true, body: { keys: [] } }
            : { ok: false, status };
        },
        ensureCloudflareLogin: async () => calls.push("login"),
        deployWorker: async () => {
          calls.push("upgrade");
          if (failedUpgrade) throw Error("upload failed");
          updated = true;
        },
        assertServerInventory: async () => calls.push("verify-keys"),
        randomSecret: () => {
          calls.push("create-key");
          return "x".repeat(32);
        },
        nextDisplayOrder: () => 10,
        parseServices: () => [],
        writePrivateJson: async () => calls.push("write"),
        publishNodeKeys: async () => calls.push("publish-keys"),
      });
      new vm.Script(
        ["ensureKeyInventory", "createNodeRecords"].map(procedure).join("\n"),
      ).runInContext(context);
      const add = () =>
        context.createNodeRecords(state, [
          { id: "new-node", displayName: "New Node", services: [] },
        ]);
      if ([401, 500].includes(status) || failedUpgrade) {
        await assert.rejects(add());
        assert.deepEqual(state.nodeKeys, {});
        assert.ok(!calls.includes("write") && !calls.includes("create-key"));
        if (status !== 404) assert.deepEqual(calls, ["inventory"]);
      } else {
        await add();
        assert.ok(calls.indexOf("verify-keys") < calls.indexOf("create-key"));
        if (status === 404)
          assert.deepEqual(calls.slice(0, 5), [
            "inventory",
            "login",
            "upgrade",
            "inventory",
            "verify-keys",
          ]);
        else assert.ok(!calls.includes("upgrade"));
      }
    }
  }
});

test("rollback validates the version and prepares D1 before changing the live Worker", async () => {
  for (const mode of [
    "success",
    "cancel",
    "unknown-version",
    "schema-failure",
  ]) {
    const calls = [];
    const version = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const context = vm.createContext({
      rollbackWithSchema,
      nodeIdentityRollbackSQL,
      line: () => {},
      fail: (message) => {
        throw Error(message);
      },
      workerDeploymentState: async () => ({
        workerUrl: "https://monitor.example",
      }),
      ensureCloudflareLogin: async () => {},
      wranglerConfigPath: "wrangler.jsonc",
      wrangler: async (args) => {
        if (args[0] === "versions") {
          calls.push("validate-version");
          assert.deepEqual(Array.from(args).slice(0, 3), [
            "versions",
            "view",
            version,
          ]);
          if (mode === "unknown-version") throw Error("unknown version");
        } else {
          calls.push("rollback");
          assert.equal(args[0], "rollback");
          assert.equal(args[1], version);
        }
      },
      databaseQuery: async (_state, sql) => {
        if (sql.startsWith("PRAGMA")) return [];
        calls.push("prepare-schema");
        assert.match(sql, /ADD COLUMN short_mark/);
        if (mode === "schema-failure") throw Error("schema failed");
      },
      verifyHealth: async () => {
        calls.push("verify");
        return true;
      },
    });
    new vm.Script(procedure("rollbackWorker")).runInContext(context);
    const run = () =>
      context.rollbackWorker(
        { yes: async () => mode !== "cancel" },
        version,
        new Map(),
      );
    if (["unknown-version", "schema-failure"].includes(mode))
      await assert.rejects(run());
    else await run();
    const expected =
      mode === "success"
        ? ["validate-version", "prepare-schema", "rollback", "verify"]
        : mode === "schema-failure"
          ? ["validate-version", "prepare-schema"]
          : ["validate-version"];
    assert.deepEqual(calls, expected);
  }
});
