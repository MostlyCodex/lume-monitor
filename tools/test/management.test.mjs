import assert from "node:assert/strict";
import test from "node:test";
import { applyPending, keyProof, parseJsonc, restorePeerProbes, validateImportedConfig, verifyKeyInventory, workerOrigin } from "../management.mjs";

test("JSONC preserves URLs, escaped quotes and comma-like text", () => {
  assert.deepEqual(parseJsonc('{/* c */"url":"https://example.com/a,//x", //line\n "list":["\\\" ,}",],}'), {url:"https://example.com/a,//x", list:['" ,}']});
  assert.throws(() => parseJsonc('{/* unclosed'), /未闭合/);
});

test("adoption verifies every key, including one that never reported", () => {
  const keys = { alpha: "a".repeat(64), pending: "b".repeat(64) };
  const inventory = {keys:Object.entries(keys).map(([node_id, secret]) => ({node_id, proof:keyProof(node_id,secret)})), revoked_node_ids:[]};
  verifyKeyInventory(keys, inventory);
  assert.throws(() => verifyKeyInventory({alpha:keys.alpha}, inventory), /完整清单/);
  assert.throws(() => verifyKeyInventory({...keys, alpha:"x".repeat(64)}, inventory), /密钥与线上/);
  assert.throws(() => verifyKeyInventory({...keys, unknown:"c".repeat(64)}, inventory), /完整清单/);
  assert.throws(() => verifyKeyInventory(keys, {...inventory, keys:[inventory.keys[0],inventory.keys[0]]}), /完整清单/);
});

test("adoption rejects credentials belonging to another node or backend", () => {
  const config = {node:{id:"alpha"}, secret:"x".repeat(64), endpoint:"https://monitor.example/api/v1/report", services:[], probes:[]};
  validateImportedConfig(config, "alpha", "https://monitor.example");
  assert.throws(() => validateImportedConfig(config, "beta", "https://monitor.example"), /ID/);
  assert.throws(() => validateImportedConfig(config, "alpha", "https://other.example"), /上报地址/);
  assert.throws(() => workerOrigin("https://user:pass@monitor.example/"));
  assert.throws(() => workerOrigin("http://monitor.example/"));
  assert.equal(workerOrigin("https://monitor.example/"), "https://monitor.example");
});

test("partial deployment retains unfinished peers and can resume", async () => {
  const state = { nodes: {alpha:{}, beta:{}, gamma:{}} };
  const saved = [];
  await assert.rejects(applyPending(state, ["alpha","beta","gamma"], {save:async (s) => saved.push(structuredClone(s)), deploy:async (id) => {if(id === "beta") throw Error("SSH unavailable");}}));
  assert.equal(saved[0].nodes.alpha.pendingApply, true);
  assert.equal(state.nodes.alpha.pendingApply, undefined);
  assert.equal(state.nodes.beta.pendingApply, true);
  assert.equal(state.nodes.gamma.pendingApply, true);
  const resumed = [];
  await applyPending(state, ["beta","gamma"], {save:async()=>{},deploy:async(id)=>resumed.push(id)});
  assert.deepEqual(resumed,["beta","gamma"]);
  assert.ok(Object.values(state.nodes).every((node)=>!node.pendingApply));
});

test("restoring routes is idempotent and refuses to overwrite changed probes", () => {
  const archived = [{name:"peer", kind:"icmp", target_node_id:"alpha", target:"alpha.example"}];
  const current = [{name:"external", kind:"icmp", target:"reference.example"}];
  const restored = restorePeerProbes(current, archived);
  assert.deepEqual(restorePeerProbes(restored, archived), restored);
  assert.equal(current.length,1);
  assert.throws(() => restorePeerProbes([{...archived[0],target:"changed.example"}], archived), /冲突/);
});
