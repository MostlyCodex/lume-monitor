import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import vm from "node:vm";
import test from "node:test";
import { keyProof, parseJsonc, validateImportedConfig, verifyKeyInventory, workerOrigin } from "../management.mjs";
import { validateNodeId, validateSshTarget, validateWorkerName } from "../lumectl.mjs";
import { InputError, inputValue } from "../prompts.mjs";
import { configFingerprint, configurationStatus, serializeAgentConfig } from "../network-accounting.mjs";

const source = await readFile(new URL("../lumectl.mjs", import.meta.url), "utf8");
function procedure(name) {
  const start = source.indexOf(`async function ${name}(`);
  assert.ok(start >= 0);
  const remaining = source.slice(start);
  const next = remaining.slice(1).search(/\n(?:async )?function /);
  return next < 0 ? remaining : remaining.slice(0, next + 1);
}

test("deployment confirmation ignores a report from before the deployment", async()=>{
  let polls=0;
  const context=vm.createContext({Date,adminNodeList:async()=>[{node_id:"alpha",last_report_at:++polls===1?100:201}],sleep:async()=>{}});
  new vm.Script(procedure("waitForFirstReport")).runInContext(context);
  const node=await context.waitForFirstReport({},"alpha",1,200);
  assert.equal(node.last_report_at,201);
  assert.equal(polls,2);
});

async function adoptHarness({wrongKey=false, changedDuringInput=false, missingInterface=false, databaseFailure=false, unauthorized=false, deleting=false}={}) {
  const secret="existing-key-".repeat(5);
  const inventory={keys:[{node_id:"alpha",proof:keyProof("alpha",secret)}],revoked_node_ids:[]};
  const writes=[];
  const calls=[];
  let databaseReady=false, workerUpdated=false;
  const context=vm.createContext({
    Object,Map,Set,Date,JSON,join,privateDir:"memory",statePath:"state.json",wranglerConfigPath:"wrangler.jsonc",
    validateNodeId,validateSshTarget,validateWorkerName,parseJsonc,workerOrigin,validateImportedConfig,verifyKeyInventory,InputError,inputValue,
    fail:(message)=>{throw Error(message);},line:()=>{},loadState:async()=>null,exists:async()=>true,
    readFile:async()=>JSON.stringify({name:"monitor",d1_databases:[{binding:"DB",database_name:"monitor-db",database_id:"existing-d1"}]}),
    adminFetch:async(_state,path)=>{
      if(unauthorized)return {ok:false,status:401,body:{error:"unauthorized"}};
      if(path.endsWith("/key-inventory"))return missingInterface&&!workerUpdated?{ok:false,status:404}:{ok:true,status:200,body:inventory};
      assert.ok(path.endsWith("/nodes"));
      calls.push("read-nodes");
      return databaseReady?{ok:true,status:200,body:{nodes:[{node_id:"alpha",deletion_pending:deleting}]}}:{ok:false,status:500,body:{error:"node listing failed"}};
    },
    prepareDatabase:async()=>{calls.push("prepare-database");if(databaseFailure)throw Error("database verification interrupted");databaseReady=true;},
    databaseQuery:async()=>[],
    ensureCloudflareLogin:async()=>calls.push("login"),
    wrangler:async(args)=>{
      {
        assert.equal(args[0],"deploy");
        assert.ok(args.includes("--keep-vars"));
        assert.equal(databaseReady,true,"D1 must be upgraded before the Worker");
        calls.push("deploy-worker");
        workerUpdated=true;
      }
    },
    deployWorker:async(state)=>{
      await context.prepareWorkerDatabase(state);
      await context.wrangler(["deploy","--keep-vars"]);
    },
    readNodeConfiguration:async()=>{
      calls.push("read-config");
      return {target:"ssh-alpha",config:{node:{id:"alpha",unexpected_display_field:"ignored"},secret:wrongKey?"wrong-".repeat(12):secret,endpoint:"https://monitor.example/api/v1/report",services:[],probes:[]}};
    },
    getServerInventory:async()=>changedDuringInput?{keys:[],revoked_node_ids:[]}:inventory,
    writePrivateJson:async(path,value)=>writes.push({path,value:structuredClone(value)}),
  });
  const signature=source.slice(source.indexOf("function inventorySignature("),source.indexOf("async function getServerInventory("));
  new vm.Script(signature+["prepareWorkerDatabase","adminNodeSnapshot","adminNodeList","adoptDeployment"].map(procedure).join("\n")).runInContext(context);
  const run=()=>context.adoptDeployment({text:async()=>"https://monitor.example",secret:async()=>"admin-".repeat(12),yes:async()=>true});
  return {run,writes,secret,calls};
}

test("adoption verifies an existing Worker database before reading its nodes and preserves credentials",async()=>{
  const h=await adoptHarness();
  await h.run();
  const state=h.writes.find((entry)=>entry.path==="state.json").value;
  assert.equal(state.nodeKeys.alpha,h.secret);
  const stored=h.writes.find(entry=>entry.path.endsWith("config.json")).value;
  assert.equal(Object.hasOwn(stored.node,"unexpected_display_field"),false);
  assert.equal(stored.secret,h.secret);
  assert.equal(state.databaseId,"existing-d1");
  assert.equal(state.nodes.alpha.sshTarget,"ssh-alpha");
  assert.deepEqual(h.calls,["login","prepare-database","read-nodes","read-config"]);
});

test("adoption verifies D1 before deploying a missing Worker management interface",async()=>{
  const h=await adoptHarness({missingInterface:true});
  await h.run();
  assert.deepEqual(h.calls,["login","prepare-database","deploy-worker","read-nodes","read-config"]);
});

test("adoption stops before node reads and local writes when database verification fails",async()=>{
  for(const missingInterface of [false,true]) {
    const h=await adoptHarness({missingInterface,databaseFailure:true});
    await assert.rejects(h.run(),/database verification interrupted/);
    assert.deepEqual(h.calls,["login","prepare-database"]);
    assert.equal(h.writes.length,0);
  }
});

test("adoption does not initialize or save state when authentication fails",async()=>{
  const h=await adoptHarness({unauthorized:true});
  await assert.rejects(h.run(),/HTTP 401/);
  assert.deepEqual(h.calls,[]);
  assert.equal(h.writes.length,0);
});

test("node directory errors retain their HTTP status without exposing response contents",async()=>{
  for(const response of [{ok:false,status:401},{ok:false,status:500},{ok:true,status:200}]) {
    const context=vm.createContext({
      adminFetch:async()=>({...response,body:{error:"private-response-marker"}}),
      fail:(message)=>{throw Error(message);},
    });
    new vm.Script(["adminNodeSnapshot","adminNodeList"].map(procedure).join("\n")).runInContext(context);
    await assert.rejects(context.adminNodeList({}),(error)=>{
      assert.match(error.message,new RegExp(`HTTP ${response.status}`));
      assert.ok(!error.message.includes("private-response-marker"));
      return true;
    });
  }
});

test("adoption writes no management state if a key is wrong or the server changes",async()=>{
  for(const options of [{wrongKey:true},{changedDuringInput:true}]) {
    const h=await adoptHarness(options);
    await assert.rejects(h.run());
    assert.equal(h.writes.length,0);
  }
});

test("deployment upgrades missing acknowledgement or node metadata capabilities before touching the Agent",async()=>{
 for (const [initialStatus,capabilities] of [[200,{}],[200,{config_fingerprint:1}],[401,{}]]) {
  const calls=[];let updated=false;
  const context=vm.createContext({
   line:()=>{},fail:message=>{throw Error(message);},wranglerConfigPath:"memory/wrangler.jsonc",
   adminFetch:async()=>({ok:initialStatus===200,status:initialStatus,body:{nodes:[],capabilities:updated?{config_fingerprint:1,node_metadata:2}:capabilities}}),
   ensureCloudflareLogin:async()=>calls.push("login"),prepareWorkerDatabase:async()=>calls.push("prepare-database"),readVersion:async()=>"1.0.0",
   deployWorker:async()=>{calls.push("prepare-database","update-worker");updated=true;},
  });
  new vm.Script(procedure("ensureConfigurationReporting")).runInContext(context);
  if(initialStatus===401){await assert.rejects(context.ensureConfigurationReporting({}),/401/);assert.deepEqual(calls,[]);}
  else {await context.ensureConfigurationReporting({});assert.deepEqual(calls,["login","prepare-database","update-worker"]);await context.ensureConfigurationReporting({});assert.equal(calls.length,3);}
 }
});


test("status does not warn about disabled legacy nodes and preserves Worker capability diagnostics",async()=>{
 for(const supportsFingerprint of [false,true]) {
  const messages=[],calls=[];
  const local={stage:"ready",workerName:"monitor",databaseName:"lume",workerUrl:"https://monitor.example",nodes:{alpha:{installed:true}}};
  const snapshot={nodes:[
   {node_id:"alpha",enabled:true,deletion_pending:false,last_report_at:100,last_report_age_seconds:1},
   {node_id:"unmanaged-live",enabled:true,deletion_pending:false},
   {node_id:"disabled-legacy",enabled:false,deletion_pending:false},
   {node_id:"deleting-node",enabled:true,deletion_pending:true},
  ],...(supportsFingerprint?{capabilities:{config_fingerprint:1}}:{})};
  const context=vm.createContext({
   Object,Map,JSON,join,privateDir:"memory/.lume",configFingerprint,serializeAgentConfig,configurationStatus,
   loadState:async()=>local,line:message=>messages.push(message),fail:message=>{throw Error(message);},
   readFile:async()=>JSON.stringify({node:{id:"alpha"},secret:"private-config-marker"}),
   adminFetch:async(_state,path)=>{calls.push(path);return {ok:true,status:200,body:snapshot};},
   verifyHealth:async()=>calls.push("health"),
   writePrivateJson:async()=>{throw Error("Status must not modify deployment state");},
  });
  new vm.Script(["adminNodeSnapshot","showStatus"].map(procedure).join("\n")).runInContext(context);
  await context.showStatus();
  assert.deepEqual(calls,["/api/v1/admin/nodes","health"]);
  assert.deepEqual(messages.filter(message=>message.startsWith("!")),["! Worker 上已启用但未纳入本地管理的节点：unmanaged-live"]);
  assert.ok(messages.includes("已禁用的远端目录记录：disabled-legacy"));
  const output=messages.join("\n");
  assert.match(output,supportsFingerprint?/Agent 未上报配置摘要/:/Worker 尚不支持配置核验/);
  assert.ok(output.includes("下线待完成（菜单 7 继续）：deleting-node"));
  assert.ok(!output.includes("private-config-marker"));
 }
});


test("offboarding verifies deletion capabilities before preparing permanent cleanup", async () => {
  for (const mode of ["current", "upgrade", "unauthorized", "unavailable"]) {
    const calls = [];
    let updated = mode === "current";
    const context = vm.createContext({
      loadState: async () => ({}), line: () => {}, fail: message => {throw Error(message);},
      statePath: "memory/state.json", writePrivateJson: async () => {},
      assertServerInventory: async () => {}, publishNodeKeys: async () => {}, publishRevokedNodeIds: async () => {},
      ensureCloudflareLogin: async () => calls.push("login"),
      deployWorker: async () => {calls.push("deploy"); updated = mode !== "unavailable";},
      adminFetch: async (_state, path, options) => {
        if (path.endsWith("/deletion")) {
          assert.equal(updated, true);
          assert.equal(options.method, "POST");
          calls.push("prepare");
          return {ok:true,body:{ok:true}};
        }
        assert.equal(path, "/api/v1/admin/nodes");
        return {ok:mode !== "unauthorized", status:mode === "unauthorized" ? 401 : 200,
          body:{capabilities:{permanent_delete:updated ? 2 : 1}}};
      },
      deleteManagedNode: async (id, {state, io}) => {
        await io.ensureBackend(state);
        await io.prepareDeletion(state, id);
      },
    });
    new vm.Script(procedure("deleteNode")).runInContext(context);
    const operation = context.deleteNode({}, "alpha", new Map());
    if (mode === "unauthorized") {
      await assert.rejects(operation, /无法读取后端/);
      assert.deepEqual(calls, []);
    } else if (mode === "unavailable") {
      await assert.rejects(operation, /尚未支持/);
      assert.deepEqual(calls, ["login", "deploy"]);
    } else {
      await operation;
      assert.deepEqual(calls, mode === "current" ? ["prepare"] : ["login", "deploy", "prepare"]);
    }
  }
});


test("adoption retains remote deletion progress so the node ID stays reserved", async () => {
  const h = await adoptHarness({deleting:true});
  await h.run();
  const state = h.writes.find(entry => entry.path === "state.json").value;
  assert.deepEqual(state.pendingDeletes, {alpha:{}});
});
