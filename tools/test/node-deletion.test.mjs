import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { deleteManagedNode } from "../node-deletion.mjs";
import { applyNodeFilePlan, nodeFilePlan } from "../private-node-data.mjs";
import { PromptCancelled } from "../prompts.mjs";

async function harness(t) {
  const root = await mkdtemp(join(tmpdir(), "lume-delete-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const write = async (path, value) => {
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, JSON.stringify(value));
  };
  const files = {
    alpha: join(root, "nodes", "alpha", "config.json"),
    beta: join(root, "nodes", "beta", "config.json"),
    backup: join(root, "backups", "state.json"),
    ownBackup: join(root, "backups", "alpha.json"),
    stateTemp: join(root, ".state.json.123456789abc.tmp"),
  };
  const alpha = { node: { id: "alpha" }, secret: "fixture-key", probes: [] };
  const beta = {
    node: { id: "beta" },
    secret: "other-key",
    probes: [
      { name: "alpha-probe", target_node_id: "alpha" },
      { name: "reference", target: "example.com" },
    ],
  };
  const initial = {
    nodes: {
      alpha: { sshTarget: "ssh-alpha" },
      beta: { sshTarget: "ssh-beta" },
    },
    nodeKeys: { alpha: "fixture-key", beta: "other-key" },
    retiredNodes: {
      gamma: {
        peerProbes: {
          beta: [{ target_node_id: "alpha" }, { target_node_id: "gamma" }],
        },
      },
    },
    revokedNodeIds: ["alpha", "elsewhere"],
    keyInventory: {
      keys: [
        { node_id: "alpha", proof: "private-proof" },
        { node_id: "beta", proof: "other-proof" },
      ],
      revoked_node_ids: ["alpha", "elsewhere"],
    },
  };
  await write(files.alpha, alpha);
  await write(files.beta, beta);
  await write(files.backup, initial);
  await write(files.ownBackup, alpha);
  await write(files.stateTemp, initial);
  let saved = structuredClone(initial),
    failed = "",
    deleted = false;
  const calls = [],
    lines = [];
  const action = async (name, fn = () => {}) => {
    calls.push(name);
    if (failed === name) {
      failed = "";
      throw Error("interrupted: " + name);
    }
    return fn();
  };
  const io = {
    line: (message) => lines.push(message),
    ensureBackend: async () => {},
    assertInventory: async () => {},
    summary: async () => ({
      rows: deleted ? 0 : 27,
      peers: deleted ? [] : [{ node_id: "beta", probe_name: "alpha-probe" }],
    }),
    checkPeer: async (id) => {
      const config = JSON.parse(
        await readFile(join(root, "nodes", id, "config.json"), "utf8"),
      );
      assert.equal(config.node.id, id);
    },
    plan: (id) => nodeFilePlan(root, id),
    clean: (plan) => action("clean", () => applyNodeFilePlan(plan, write)),
    remoteChoice: async (target, absent) => ({
      sshTarget: target,
      agentAbsent: absent,
    }),
    save: async (state) => {
      saved = structuredClone(state);
    },
    publishKeys: async (state) =>
      action("keys", () => {
        assert.equal(state.nodeKeys.alpha, undefined);
      }),
    publishRevocations: async (state) =>
      action("revocations", () => {
        assert.ok(!state.revokedNodeIds.includes("alpha"));
      }),
    retire: () => action("retire"),
    uninstall: (target) =>
      action("uninstall", () => assert.equal(target, "ssh-alpha")),
    applyPeers: (ids, state) =>
      action("peers", async () => {
        assert.deepEqual(ids, ["beta"]);
        const config = JSON.parse(await readFile(files.beta, "utf8"));
        assert.deepEqual(config.probes, [
          { name: "reference", target: "example.com" },
        ]);
        delete state.nodes.beta.pendingApply;
      }),
    purge: () =>
      action("purge", () => {
        deleted = true;
      }),
  };
  return {
    root,
    files,
    calls,
    lines,
    io,
    get state() {
      return saved;
    },
    set failure(value) {
      failed = value;
    },
    run: (options = new Map([["yes", true]]), prompt = {}) =>
      deleteManagedNode("alpha", {
        state: structuredClone(saved),
        options,
        prompt,
        io,
      }),
  };
}

test("permanent deletion cleans private backups and peers, leaving no restoration record", async (t) => {
  const h = await harness(t);
  await h.run();
  for (const path of [h.files.alpha, h.files.ownBackup])
    await assert.rejects(readFile(path), { code: "ENOENT" });
  for (const value of [
    h.state,
    JSON.parse(await readFile(h.files.backup, "utf8")),
    JSON.parse(await readFile(h.files.stateTemp, "utf8")),
  ]) {
    assert.equal(value.nodes.alpha, undefined);
    assert.equal(value.nodeKeys.alpha, undefined);
    assert.equal(value.retiredNodes.alpha, undefined);
    assert.equal(value.nodes.beta.sshTarget, "ssh-beta");
    assert.equal(value.nodeKeys.beta, "other-key");
    assert.deepEqual(value.retiredNodes.gamma.peerProbes.beta, [
      { target_node_id: "gamma" },
    ]);
    assert.deepEqual(value.keyInventory.keys, [
      { node_id: "beta", proof: "other-proof" },
    ]);
  }
  assert.equal(h.state.pendingDeletes, undefined);
  assert.ok(h.calls.indexOf("keys") < h.calls.indexOf("uninstall"));
  assert.ok(h.calls.indexOf("peers") < h.calls.indexOf("purge"));
});

for (const stage of [
  "keys",
  "revocations",
  "retire",
  "uninstall",
  "clean",
  "peers",
  "purge",
])
  test("deletion resumes after " + stage + " fails", async (t) => {
    const h = await harness(t);
    h.failure = stage;
    await assert.rejects(h.run(), new RegExp("interrupted: " + stage));
    assert.ok(h.state.pendingDeletes.alpha);
    if (["keys", "revocations", "retire", "uninstall"].includes(stage))
      assert.ok(await readFile(h.files.alpha));
    const remoteDone = h.state.pendingDeletes.alpha.remoteDone;
    h.calls.length = 0;
    await h.run();
    assert.equal(h.state.pendingDeletes, undefined);
    assert.ok(
      h.calls.includes("revocations"),
      "a failed publication must be retried even if local state already changed",
    );
    if (remoteDone) assert.ok(!h.calls.includes("uninstall"));
    assert.ok(
      h.calls.includes("peers"),
      "saved peer work survives local configuration cleanup",
    );
  });

test("confirmation requires the exact node ID; cancellation performs no destructive operations", async (t) => {
  const h = await harness(t),
    answers = ["y", "wrong", "/cancel"];
  await assert.rejects(
    h.run(new Map(), { text: async () => answers.shift() }),
    PromptCancelled,
  );
  assert.deepEqual(h.calls, []);
  assert.ok(h.state.nodeKeys.alpha);
  assert.ok(await readFile(h.files.alpha));
});

test("permanent deletion also accepts a retired node and an explicitly destroyed VPS", async (t) => {
  const h = await harness(t);
  h.io.remoteChoice = async () => ({ sshTarget: "", agentAbsent: true });
  const state = structuredClone(h.state);
  state.retiredNodes.alpha = state.nodes.alpha;
  delete state.nodes.alpha;
  delete state.nodeKeys.alpha;
  await h.io.save(state);
  await h.run(
    new Map([
      ["yes", true],
      ["agent-absent", true],
    ]),
  );
  assert.ok(!h.calls.includes("uninstall"));
  assert.equal(h.state.retiredNodes.alpha, undefined);
});

test("unreadable related configuration stops deletion before credentials or remote files change", async (t) => {
  const h = await harness(t);
  await writeFile(h.files.beta, "invalid JSON");
  await assert.rejects(h.run(), /无法读取配置/);
  assert.deepEqual(h.calls, []);
});

test("local cleanup refuses redirected directories and preserves the external target", async (t) => {
  const h = await harness(t);
  const external = await mkdtemp(join(tmpdir(), "lume-delete-external-"));
  t.after(() => rm(external, { recursive: true, force: true }));
  await writeFile(
    join(external, "keep.json"),
    JSON.stringify({ node: { id: "alpha" } }),
  );
  await rm(join(h.root, "nodes", "alpha"), { recursive: true });
  try {
    await symlink(external, join(h.root, "nodes", "alpha"), "junction");
  } catch (error) {
    if (error.code === "EPERM") {
      t.skip("symbolic links require OS permission");
      return;
    }
    throw error;
  }
  await assert.rejects(h.run(), /无法安全清理/);
  assert.ok(await readFile(join(external, "keep.json")));
  assert.deepEqual(h.calls, []);
});
