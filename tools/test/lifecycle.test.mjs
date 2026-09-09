import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, sep } from "node:path";
import vm from "node:vm";
import test from "node:test";
import { applyPending, keyProof, parseJsonc, restorePeerProbes, validateImportedConfig, verifyKeyInventory, workerOrigin } from "../management.mjs";
import { validateNodeId, validateSshTarget, validateWorkerName } from "../lumectl.mjs";

const source = await readFile(new URL("../lumectl.mjs", import.meta.url), "utf8");
function procedure(name) {
  const start = source.indexOf(`async function ${name}(`);
  assert.ok(start >= 0);
  const remaining = source.slice(start);
  const next = remaining.slice(1).search(/\n(?:async )?function /);
  return next < 0 ? remaining : remaining.slice(0, next + 1);
}

// Execute the actual CLI procedures with in-memory files and fake transports.
// These tests never read private state, connect to SSH or contact Cloudflare.
function harness() {
  const privateDir = join("memory", ".lume"), statePath = join(privateDir, "state.json");
  const config = (id) => ({node:{id},endpoint:"https://monitor.example/api/v1/report",secret:`${id}-`.repeat(16),services:[],probes:[],nftables_counters:[]});
  const alpha = config("alpha"), beta = config("beta");
  beta.probes = [{name:"to-alpha",kind:"icmp",target_node_id:"alpha",target:"alpha.example"},{name:"reference",kind:"icmp",target:"reference.example"}];
  const files = new Map([[join(privateDir,"nodes","alpha","config.json"),JSON.stringify(alpha)],[join(privateDir,"nodes","beta","config.json"),JSON.stringify(beta)]]);
  let saved = {workerUrl:"https://monitor.example",nodeKeys:{alpha:alpha.secret,beta:beta.secret},nodes:{alpha:{sshTarget:"ssh-alpha",installed:true},beta:{sshTarget:"ssh-beta",installed:true}},revokedNodeIds:[]};
  const calls = [];
  const failures = {deploy:null,write:null};
  const save = async (state) => {saved = structuredClone(state);};
  const write = async(path,value) => {
    if(failures.write === path) {failures.write=null;throw Error("write interrupted");}
    if(path === statePath) await save(value);
    else files.set(path,JSON.stringify(value));
  };
  const deploy = async(id,target,options) => {
    calls.push(`deploy:${id}`);
    if(failures.deploy === id) {failures.deploy=null;throw Error("SSH unavailable");}
    options.state.nodes[id].installed=true;
    await save(options.state);
    if(options.activate) calls.push(`fresh-report:${id}`);
  };
  const context=vm.createContext({
    Object,Map,Set,Date,JSON,join,privateDir,privateDirName:".lume",statePath,
    validateNodeId,validateSshTarget,validateImportedConfig,restorePeerProbes,
    line:()=>{},fail:(message)=>{throw Error(message);},loadState:async()=>structuredClone(saved),
    readFile:async(path)=>{if(!files.has(path))throw Error(`missing ${path}`);return files.get(path);},
    exists:async(path)=>files.has(path),writePrivateJson:write,
    rm:async(path)=>{for(const key of files.keys())if(key===path||key.startsWith(path+sep))files.delete(key);},
    assertServerInventory:async()=>calls.push("verify-inventory"),
    publishNodeKeys:async(state)=>{calls.push("publish-keys");await save(state);},
    publishRevokedNodeIds:async(state)=>{calls.push("publish-revocations");await save(state);},
    adminFetch:async(_state,path)=>{calls.push(path.endsWith("/retire")?"retire":"restore");return {ok:true};},
    run:async()=>calls.push("stop-agent"),uninstallRemoteAgent:async()=>calls.push("uninstall-agent"),
    applyNodes:async(_prompt,ids,state)=>applyPending(state,ids,{save,deploy:async(id)=>deploy(id,null,{state})}),
    randomSecret:()=>"new-independent-secret-".repeat(3),installNode:deploy,
    nodeTarget:async(_prompt,state,id)=>state.nodes[id].sshTarget,
  });
  new vm.Script(["peersTargeting","removeNode","restoreNode"].map(procedure).join("\n")).runInContext(context);
  const prompt={yes:async()=>true,text:async(_label,fallback)=>fallback};
  return {files,failures,calls,privateDir,get state(){return saved;},remove:(options=new Map())=>context.removeNode(prompt,"alpha",options),restore:()=>context.restoreNode(prompt,"alpha",new Map())};
}

test("retirement archives configuration, revokes access and deploys peer cleanup", async()=>{
  const h=harness();
  await h.remove();
  assert.equal(h.state.nodeKeys.alpha,undefined);
  assert.equal(h.state.nodes.alpha,undefined);
  assert.ok(h.state.retiredNodes.alpha.peerProbes.beta.length);
  assert.ok(h.files.has(join(h.privateDir,"retired","alpha","config.json")));
  const peer=JSON.parse(h.files.get(join(h.privateDir,"nodes","beta","config.json")));
  assert.deepEqual(peer.probes.map((entry)=>entry.name),["reference"]);
  assert.ok(h.calls.indexOf("publish-keys")<h.calls.indexOf("retire"));
  assert.ok(h.calls.indexOf("retire")<h.calls.indexOf("deploy:beta"));
});

test("retirement resumes even when writing the peer configuration was interrupted", async()=>{
  const h=harness();
  h.failures.write=join(h.privateDir,"nodes","beta","config.json");
  await assert.rejects(h.remove(),/write interrupted/);
  assert.equal(h.state.nodes.alpha,undefined);
  await h.remove();
  const peer=JSON.parse(h.files.get(join(h.privateDir,"nodes","beta","config.json")));
  assert.ok(peer.probes.every((entry)=>entry.target_node_id!=="alpha"));
  assert.equal(h.state.nodes.beta.pendingApply,undefined);
  assert.ok(h.calls.includes("deploy:beta"));
});

test("restoration rotates credentials, waits for a fresh report, then restores peers", async()=>{
  const h=harness();
  const oldKey=h.state.nodeKeys.alpha;
  await h.remove(new Map([["uninstall",true]]));
  h.calls.length=0;
  await h.restore();
  assert.notEqual(h.state.nodeKeys.alpha,oldKey);
  assert.equal(h.state.retiredNodes.alpha,undefined);
  assert.equal(h.state.nodes.alpha.pendingRestore,undefined);
  assert.ok(h.calls.indexOf("publish-keys")<h.calls.indexOf("deploy:alpha"));
  assert.ok(h.calls.indexOf("fresh-report:alpha")<h.calls.indexOf("restore"));
  assert.ok(h.calls.indexOf("restore")<h.calls.indexOf("deploy:beta"));
  const peer=JSON.parse(h.files.get(join(h.privateDir,"nodes","beta","config.json")));
  assert.equal(peer.probes.filter((entry)=>entry.target_node_id==="alpha").length,1);
});

test("a failed restore retains its new key and can retry without double rotation", async()=>{
  const h=harness();
  await h.remove();
  h.failures.deploy="alpha";
  await assert.rejects(h.restore(),/SSH unavailable/);
  const pendingKey=h.state.nodeKeys.alpha;
  assert.equal(h.state.nodes.alpha.pendingRestore,true);
  await h.restore();
  assert.equal(h.state.nodeKeys.alpha,pendingKey);
  assert.equal(h.state.retiredNodes.alpha,undefined);
});

test("deployment confirmation ignores a report from before the deployment", async()=>{
  let polls=0;
  const context=vm.createContext({Date,adminNodeList:async()=>[{node_id:"alpha",last_report_at:++polls===1?100:201}],sleep:async()=>{}});
  new vm.Script(procedure("waitForFirstReport")).runInContext(context);
  const node=await context.waitForFirstReport({},"alpha",1,200);
  assert.equal(node.last_report_at,201);
  assert.equal(polls,2);
});

async function adoptHarness({wrongKey=false, changedDuringInput=false}={}) {
  const secret="existing-key-".repeat(5);
  const inventory={keys:[{node_id:"alpha",proof:keyProof("alpha",secret)}],revoked_node_ids:[]};
  const writes=[];
  const context=vm.createContext({
    Object,Map,Set,Date,JSON,join,privateDir:"memory",statePath:"state.json",wranglerConfigPath:"wrangler.jsonc",
    validateNodeId,validateSshTarget,validateWorkerName,parseJsonc,workerOrigin,validateImportedConfig,verifyKeyInventory,
    fail:(message)=>{throw Error(message);},line:()=>{},loadState:async()=>null,exists:async()=>true,
    readFile:async()=>JSON.stringify({name:"monitor",d1_databases:[{binding:"DB",database_name:"monitor-db",database_id:"existing-d1"}]}),
    adminFetch:async()=>({ok:true,status:200,body:inventory}),adminNodeList:async()=>[{node_id:"alpha",retired:false}],
    readNodeConfiguration:async()=>({target:"ssh-alpha",config:{node:{id:"alpha"},secret:wrongKey?"wrong-".repeat(12):secret,endpoint:"https://monitor.example/api/v1/report",services:[],probes:[]}}),
    getServerInventory:async()=>changedDuringInput?{keys:[],revoked_node_ids:[]}:inventory,
    writePrivateJson:async(path,value)=>writes.push({path,value:structuredClone(value)}),
  });
  const signature=source.slice(source.indexOf("function inventorySignature("),source.indexOf("async function getServerInventory("));
  new vm.Script(signature+procedure("adoptDeployment")).runInContext(context);
  const run=()=>context.adoptDeployment({text:async()=>"https://monitor.example",secret:async()=>"admin-".repeat(12)});
  return {run,writes,secret};
}

test("adoption preserves existing credentials and only writes local management files",async()=>{
  const h=await adoptHarness();
  await h.run();
  const state=h.writes.find((entry)=>entry.path==="state.json").value;
  assert.equal(state.nodeKeys.alpha,h.secret);
  assert.equal(state.databaseId,"existing-d1");
  assert.equal(state.nodes.alpha.sshTarget,"ssh-alpha");
});

test("adoption writes no management state if a key is wrong or the server changes",async()=>{
  for(const options of [{wrongKey:true},{changedDuringInput:true}]) {
    const h=await adoptHarness(options);
    await assert.rejects(h.run());
    assert.equal(h.writes.length,0);
  }
});
