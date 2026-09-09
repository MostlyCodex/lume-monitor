import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import vm from "node:vm";
import test from "node:test";
import { normalizeNodeSpec, validateNodeId } from "../lumectl.mjs";
import {
  createCarrierProbes, editObserverEntries, externalProbes, mergeObserverEntries,
  printObserverSummary, probeTarget, promptNetworkProbes, promptNftablesCounters, selectedIndices,
} from "../observers.mjs";

const carriers = createCarrierProbes({ region: "测试地区", targets: { ct: "192.0.2.1", cu: "198.51.100.1", cm: "203.0.113.1" } });
const sourceNode = { id: "alpha", label: "Alpha", probes: carriers };
function scriptedPrompt(steps) {
  const pending = [...steps];
  const questions = [];
  const next = async (kind, question, fallback) => {
    const step = pending.shift();
    assert.ok(step, `unexpected ${kind} prompt: ${question}`);
    assert.equal(step[0], kind, question);
    if (step[2]) assert.match(question, step[2]);
    questions.push(question);
    return step[1] === "" ? fallback : step[1];
  };
  return { text:(q,f="")=>next("text",q,f), yes:(q,f=false)=>next("yes",q,f), questions, done:()=>assert.equal(pending.length,0) };
}

test("network wizard defaults to reusing selected existing carrier probes without mutating the source", async () => {
  const source = structuredClone(sourceNode);
  const prompt = scriptedPrompt([["text",""],["text","1"],["text","1,3"],["yes",false]]);
  const probes = await promptNetworkProbes(prompt, { sources:[source], line:()=>{} });
  assert.deepEqual(probes, [carriers[0], carriers[2]]);
  probes[0].target = "changed.example";
  assert.equal(source.probes[0].target, "192.0.2.1");
  prompt.done();
});

test("fresh deployment can configure all three carriers interactively without a source node", async () => {
  const prompt = scriptedPrompt([
    ["text","1"],["text","测试地区"],["text","test"],
    ["text","192.0.2.10"],["text","unicom.example"],["text","2001:db8::1"],["yes",false],
  ]);
  const probes = await promptNetworkProbes(prompt, { line:()=>{} });
  assert.deepEqual(probes.map(p=>p.name), ["test_ct","test_cu","test_cm"]);
  assert.ok(probes.every(p=>p.kind==="icmp" && p.category==="carrier-reference" && !p.port && !p.target_node_id));
  assert.match(probes[2].label,/移动/);
  prompt.done();
});

test("custom TCP and node links remain configurable from the same network wizard", async () => {
  const prompt = scriptedPrompt([
    ["text","3"],["yes",true],["text","tcp"],["text","peer_tls"],["text","Peer TLS"],
    ["text","peer.example"],["text","8443"],["text","beta"],["yes",false],
  ]);
  const probes = await promptNetworkProbes(prompt,{line:()=>{}});
  assert.equal(probes[0].target_node_id,"beta");
  assert.equal(probes[0].category,"node-link");
  assert.equal(probes[0].port,8443);
  prompt.done();
});

test("nftables remains independently configurable when network probes are skipped", async () => {
  const prompt = scriptedPrompt([
    ["text","0"],["yes",true],["text","hits"],["text","Rule hits"],["text","inet"],
    ["text","filter"],["text","input"],["text","tcp"],["text","443"],["text",""],["yes",false],
  ]);
  assert.deepEqual(await promptNetworkProbes(prompt,{line:()=>{}}),[]);
  const counters = await promptNftablesCounters(prompt,{line:()=>{}});
  assert.equal(counters[0].destination_port,443);
  assert.equal(counters[0].table,"filter");
  prompt.done();
});

test("an unavailable reuse option returns to network selection without losing the node form",async()=>{
  const prompt=scriptedPrompt([["text","2"],["text","0"]]);
  assert.deepEqual(await promptNetworkProbes(prompt,{line:()=>{}}),[]);
  prompt.done();
});

test("reusable configurations expose only external probes, never credentials or node links", () => {
  const selected = externalProbes({ secret:"do-not-copy", node:{id:"alpha"}, services:[{name:"ssh.service"}],
    probes:[...carriers,{name:"peer",kind:"tcp",target_node_id:"beta"},{name:"link",kind:"icmp",category:"node-link"}] });
  assert.deepEqual(selected,carriers);
  assert.ok(!JSON.stringify(selected).includes("do-not-copy"));
});

test("selection, target validation and merge reject invalid input and conflicting probes", () => {
  assert.deepEqual(selectedIndices("1,1,3",3),[0,2]);
  assert.deepEqual(selectedIndices("",3),[]);
  assert.deepEqual(selectedIndices("",3,{emptyMeansAll:true}),[0,1,2]);
  for(const input of ["0","4","1,,2","1.5"]) assert.throws(()=>selectedIndices(input,3));
  for(const target of ["https://example.com","host:443","-invalid.example","host/path",""]) assert.throws(()=>probeTarget(target));
  assert.equal(probeTarget("2001:db8::1"),"2001:db8::1");
  assert.deepEqual(mergeObserverEntries(carriers,carriers),carriers);
  assert.throws(()=>mergeObserverEntries(carriers,[{...carriers[0],target:"different.example"}]),/冲突/);
  assert.throws(()=>mergeObserverEntries([],carriers,{limit:2}),/最多/);
});

const cli = await readFile(new URL("../lumectl.mjs",import.meta.url),"utf8");
function procedure(name) {
  const start = cli.indexOf(`async function ${name}(`);
  assert.ok(start>=0);
  const remaining = cli.slice(start);
  const next = remaining.slice(1).search(/\n(?:async )?function /);
  return next<0?remaining:remaining.slice(0,next+1);
}

function configurationHarness({pending=false, configured=false, failDeploy=false}={}) {
  const privateDir=join("memory",".lume"), statePath=join(privateDir,"state.json");
  const configPath=join(privateDir,"nodes","beta","config.json");
  const sourcePath=join(privateDir,"nodes","alpha","config.json");
  let state={nodes:{alpha:{sshTarget:"alpha"},beta:{sshTarget:"beta",pendingApply:pending}},nodeKeys:{beta:"beta-secret"}};
  const counters=[{name:"hits",label:"Rule hits",family:"inet",table:"filter",chain:"input",protocol:"tcp",destination_port:443}];
  const config={node:{id:"beta"},secret:"beta-secret",services:[{name:"nginx.service"}],probes:configured?structuredClone(carriers):[],nftables_counters:counters};
  const files=new Map([[configPath,JSON.stringify(config)],[sourcePath,JSON.stringify({node:{id:"alpha"},secret:"source-secret",probes:carriers})]]);
  const writes=[],deployments=[],lines=[];
  const context=vm.createContext({
    Object,JSON,Date,join,privateDir,statePath,validateNodeId,
    editObserverEntries,externalProbes,printObserverSummary,promptNetworkProbes,promptNftablesCounters,
    line:(message)=>lines.push(message),fail:(message)=>{throw Error(message);},assertPlainObject:()=>{},
    loadState:async()=>structuredClone(state),exists:async(path)=>files.has(path),
    lstat:async()=>({isFile:()=>true,isSymbolicLink:()=>false}),
    readFile:async(path)=>{if(!files.has(path))throw Error("missing fixture");return files.get(path);},
    writePrivateJson:async(path,value)=>{writes.push(path);if(path===statePath)state=structuredClone(value);else files.set(path,JSON.stringify(value));},
    applyNodes:async(_prompt,ids)=>{deployments.push(...ids);if(failDeploy)throw Error("sudo password required");state.nodes.beta.pendingApply=false;},
  });
  new vm.Script(["availableProbeSources","configureNodeObservers"].map(procedure).join("\n")).runInContext(context);
  return {files,writes,deployments,lines,configPath,counters,get state(){return state;},run:(prompt)=>context.configureNodeObservers(prompt,"beta")};
}

test("new-node wizard collects probes, previews them and installs from the same command",async()=>{
  const created=[],installed=[],lines=[];
  const state={stage:"ready",nodes:{alpha:{}}};
  const context=vm.createContext({
    normalizeNodeSpec,validateNodeId,loadState:async()=>state,
    line:(message)=>lines.push(message),fail:(message)=>{throw Error(message);},
    parseServices:()=>[],printObserverSummary,
    promptOptionalObservers:async(prompt,options)=>{
      assert.equal(options.state,state);
      assert.equal(options.excludeNodeId,"beta");
      return {
        probes:await promptNetworkProbes(prompt,{sources:[sourceNode],line:(message)=>lines.push(message)}),
        nftablesCounters:await promptNftablesCounters(prompt,{line:(message)=>lines.push(message)}),
      };
    },
    createNodeRecords:async(_state,specs)=>created.push(...specs),
    installNode:async(id,ssh)=>installed.push({id,ssh}),
  });
  new vm.Script(procedure("addNode")).runInContext(context);
  const prompt=scriptedPrompt([
    ["text","beta"],["text","Beta"],["text","VPS"],["text","Test"],["text","B"],["text",""],
    ["text","2"],["text","1"],["text",""],["yes",false],["yes",false],
    ["text","ssh-beta"],["yes",true,/以上配置/],
  ]);
  await context.addNode(prompt,new Map());
  assert.deepEqual(created[0].probes,carriers);
  assert.deepEqual(installed,[{id:"beta",ssh:"ssh-beta"}]);
  assert.ok(lines.some(line=>line.includes("网络探针：3")));
  prompt.done();
});

const reuseSteps=(save=true,deploy=true)=>[
  ["yes",false,/systemd/],["text","2",/网络探针/],["text","2",/方式/],["text","1",/节点编号/],
  ["text","",/哪些探针/],["yes",false,/自定义/],["yes",false,/nftables/],
  ["yes",save,/保存/],...(save?[["yes",deploy,/部署/]]:[]),
];

test("configuration wizard reuses three carriers, preserves services and counters, previews and deploys", async()=>{
  const h=configurationHarness();
  const prompt=scriptedPrompt(reuseSteps());
  await h.run(prompt);
  const saved=JSON.parse(h.files.get(h.configPath));
  assert.deepEqual(saved.probes,carriers);
  assert.deepEqual(saved.nftables_counters,h.counters);
  assert.deepEqual(saved.services,[{name:"nginx.service"}]);
  assert.equal(saved.secret,"beta-secret");
  assert.deepEqual(h.deployments,["beta"]);
  assert.ok(h.writes.some(path=>path.includes("backups")));
  assert.ok(h.lines.some(line=>line.includes("电信")&&line.includes("192.0.2.1")));
  assert.ok(!h.lines.join("\n").includes("secret"));
  prompt.done();
});

test("declining the configuration preview performs no writes or deployments",async()=>{
  const h=configurationHarness();
  await h.run(scriptedPrompt(reuseSteps(false)));
  assert.deepEqual(h.writes,[]);
  assert.deepEqual(h.deployments,[]);
});

test("pending configuration can be deployed from the wizard even when nothing changes",async()=>{
  const h=configurationHarness({pending:true,configured:true});
  await h.run(scriptedPrompt([["yes",false],["text","1"],["yes",false],["yes",true,/部署/]]));
  assert.deepEqual(h.writes,[]);
  assert.deepEqual(h.deployments,["beta"]);
});

test("saving for later or a failed sudo deployment retains the selected probes and pending status",async()=>{
  for(const failDeploy of [false,true]) {
    const h=configurationHarness({failDeploy});
    const run=h.run(scriptedPrompt(reuseSteps(true,failDeploy)));
    if(failDeploy)await assert.rejects(run,/sudo/);else await run;
    assert.equal(h.state.nodes.beta.pendingApply,true);
    assert.deepEqual(JSON.parse(h.files.get(h.configPath)).probes,carriers);
  }
});
