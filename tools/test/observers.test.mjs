import {promptAccounting, printAccountingSummary} from "../network-accounting.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import vm from "node:vm";
import test from "node:test";
import { normalizeNodeSpec, validateNodeId, validateSshTarget } from "../lumectl.mjs";
import { InputError, PromptCancelled, PromptClosed, choiceValue, displayValue, inputValue } from "../prompts.mjs";
import {
  createCarrierProbes, editObserverEntries, mergeObserverEntries,
  printObserverSummary, probeTarget, promptNetworkProbes, promptNodeDisplay, promptServices, selectedIndices,
} from "../observers.mjs";

const carriers = createCarrierProbes({ targets: { ct: "192.0.2.1", cu: "198.51.100.1", cm: "203.0.113.1" } });
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
  return { text:(q,f="",o={})=>next("text",o.hint?`${q}（${o.hint}）`:q,f), yes:(q,f=false)=>next("yes",q,f), questions, done:()=>assert.equal(pending.length,0) };
}

const carrierAnswers = [["text","192.0.2.1"],["text","198.51.100.1"],["text","203.0.113.1"],["text","",/端口/]];
const site = (name, target) => ({ name, label: target, category: "external", kind: "tcp", target, port: 443 });

test("the wizard offers only the three TCP probe kinds", async () => {
  const lines = [];
  await promptNetworkProbes(scriptedPrompt([["text","0"]]), { line:(message)=>lines.push(message) });
  const menu = lines.join("\n");
  assert.match(menu, /1\. 三网/);
  assert.match(menu, /2\. 到其他节点/);
  assert.match(menu, /3\. 到公网网址/);
  assert.doesNotMatch(menu, /ICMP|复用|自定义/);
});

test("carriers are TCP probes named by carrier only, sharing one port", async () => {
  const prompt = scriptedPrompt([["text","1"],...carrierAnswers]);
  const probes = await promptNetworkProbes(prompt, { line:()=>{} });
  assert.deepEqual(probes, carriers);
  assert.deepEqual(probes.map(p=>p.name), ["carrier_ct","carrier_cu","carrier_cm"]);
  assert.ok(probes.every(p=>p.kind==="tcp" && p.port===80 && p.connect_timeout_ms===900 && p.samples===5 && p.category==="carrier-reference"));
  assert.deepEqual(probes.map(p=>p.label), ["电信 · TCP 80","联通 · TCP 80","移动 · TCP 80"]);
  assert.ok(prompt.questions.every(question=>!/地区/.test(question)));
  prompt.done();
});

test("a second carrier set is refused and returns to the menu", async () => {
  const lines = [];
  const prompt = scriptedPrompt([["text","1"],["text","0"]]);
  assert.deepEqual(await promptNetworkProbes(prompt, { existing:carriers, line:(message)=>lines.push(message) }), []);
  assert.ok(lines.some(line=>line.includes("已有三网探针")));
  prompt.done();
});

test("carrier target validation preserves earlier answers", async () => {
  const prompt = scriptedPrompt([
    ["text","1"],
    ["text","192.0.2.1:80",/电信/],["text","192.0.2.1",/电信/],
    ["text","198.51.100.1"],["text","203.0.113.1"],["text","443",/端口/],
  ]);
  const probes = await promptNetworkProbes(prompt, { line:()=>{} });
  assert.deepEqual(probes.map(probe=>[probe.target, probe.port]), [["192.0.2.1",443],["198.51.100.1",443],["203.0.113.1",443]]);
  prompt.done();
});

test("node links pick a target node, ask its address and a reachable port", async () => {
  const prompt = scriptedPrompt([
    ["text","2"],["text","1",/目标节点编号/],["text","203.0.113.9",/IP/],["text","24443",/端口/],["yes",false],
  ]);
  const [probe] = await promptNetworkProbes(prompt, { nodes:["beta"], line:()=>{} });
  assert.deepEqual(
    { name: probe.name, kind: probe.kind, category: probe.category, target_node_id: probe.target_node_id, target: probe.target, port: probe.port },
    { name: "link", kind: "tcp", category: "node-link", target_node_id: "beta", target: "203.0.113.9", port: 24443 },
  );
  prompt.done();
});

test("node links are unavailable without other nodes", async () => {
  const lines = [];
  const prompt = scriptedPrompt([["text","2"],["text","0"]]);
  assert.deepEqual(await promptNetworkProbes(prompt, { line:(message)=>lines.push(message) }), []);
  assert.ok(lines.some(line=>line.includes("没有其他节点")));
  prompt.done();
});

test("node link fields retry invalid input while keeping earlier answers", async () => {
  const errors = [];
  const prompt = scriptedPrompt([
    ["text","9",/方式/],["text","2",/方式/],
    ["text","2",/目标节点编号/],["text","1",/目标节点编号/],
    ["text","https://peer.example",/IP/],["text","peer.example",/IP/],
    ["text","65536",/端口/],["text","22",/端口/],["yes",false],
  ]);
  const [probe] = await promptNetworkProbes(prompt, { nodes:["beta"], line:(message)=>errors.push(message) });
  assert.equal(probe.target, "peer.example");
  assert.equal(probe.port, 22);
  assert.equal(errors.filter(message=>message.startsWith("输入无效")).length, 4);
  prompt.done();
});

test("public sites default to port 443, are named after the host and stop at two", async () => {
  const prompt = scriptedPrompt([["text","3"],["text","www.google.com",/公网网址/],["text","",/端口/],["text","",/显示名/]]);
  const probes = await promptNetworkProbes(prompt, { existing:[site("site","1.1.1.1")], line:()=>{} });
  assert.equal(probes.length, 1);
  assert.deepEqual(
    { name: probes[0].name, label: probes[0].label, port: probes[0].port, category: probes[0].category },
    { name: "site_2", label: "www.google.com", port: 443, category: "external" },
  );
  prompt.done();
  const lines = [];
  const full = scriptedPrompt([["text","3"],["text","0"]]);
  const twoSites = [site("site","1.1.1.1"), site("site_2","www.google.com")];
  assert.deepEqual(await promptNetworkProbes(full, { existing:twoSites, line:(message)=>lines.push(message) }), []);
  assert.ok(lines.some(line=>line.includes("最多 2 个")));
  full.done();
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

test("systemd retries invalid names, empty entries, duplicates and excessive counts",async()=>{
  const prompt=scriptedPrompt([
    ["text","bad name"],["text","nginx.service,,ssh.service"],["text","ssh.service,ssh.service"],
    ["text",Array.from({length:17},(_,index)=>`unit${index}.service`).join(",")],
    ["text","nginx.service,ssh.service"],
  ]);
  const services=await promptServices(prompt,{line:()=>{}});
  assert.deepEqual(services.map(service=>service.name),["nginx.service","ssh.service"]);
  assert.ok(prompt.questions.every(question=>question.includes("0–16")&&question.includes("1–80")));
  prompt.done();
});

test("full lists and invalid removal indices retry at their own selection prompt",async()=>{
  const prompt=scriptedPrompt([["text","9"],["text","2"],["text","4"],["text","4"],["text","1,3"]]);
  const result=await editObserverEntries(prompt,{label:"探针",entries:carriers,limit:3,create:()=>assert.fail("cannot append to a full list"),line:()=>{}});
  assert.deepEqual(result,[carriers[1]]);
  assert.equal(carriers.length,3);
  prompt.done();
});

const cli = await readFile(new URL("../lumectl.mjs",import.meta.url),"utf8");
function procedure(name) {
  const start = cli.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start>=0);
  const remaining = cli.slice(start);
  const next = remaining.slice(1).search(/\n(?:export )?(?:async )?function /);
  return next<0?remaining:remaining.slice(0,next+1);
}

function configurationHarness({pending=false, configured=false, failDeploy=false}={}) {
  const privateDir=join("memory",".lume"), statePath=join(privateDir,"state.json");
  const configPath=join(privateDir,"nodes","beta","config.json");
  const sourcePath=join(privateDir,"nodes","alpha","config.json");
  let state={nodes:{alpha:{sshTarget:"alpha"},beta:{sshTarget:"beta",pendingApply:pending}},nodeKeys:{beta:"beta-secret"}};
  const config={node:{id:"beta"},secret:"beta-secret",services:[{name:"nginx.service"}],probes:configured?structuredClone(carriers):[]};
  const files=new Map([[configPath,JSON.stringify(config)],[sourcePath,JSON.stringify({node:{id:"alpha"},secret:"source-secret",probes:carriers})]]);
  const writes=[],deployments=[],lines=[];
  const context=vm.createContext({
    Object,JSON,Date,join,privateDir,statePath,validateNodeId,InputError,PromptCancelled,PromptClosed,inputValue,choiceValue,displayValue,
    editObserverEntries,printObserverSummary,promptNetworkProbes,promptNodeDisplay,promptServices,promptAccounting,printAccountingSummary,readNetworkInventory:async()=>({interfaces:["eth0","eth1"],defaults:["eth0"]}),
    line:(message)=>lines.push(message),fail:(message)=>{throw Error(message);},assertPlainObject:()=>{},
    loadState:async()=>structuredClone(state),exists:async(path)=>files.has(path),
    lstat:async()=>({isFile:()=>true,isSymbolicLink:()=>false}),
    readFile:async(path)=>{if(!files.has(path))throw Error("missing fixture");return files.get(path);},
    writePrivateJson:async(path,value)=>{writes.push(path);if(path===statePath)state=structuredClone(value);else files.set(path,JSON.stringify(value));},
    applyNodes:async(_prompt,ids)=>{deployments.push(...ids);if(failDeploy)throw Error("sudo password required");state.nodes.beta.pendingApply=false;},
  });
  new vm.Script(["probeTargetNodes","configureNodeObservers"].map(procedure).join("\n")).runInContext(context);
  return {files,writes,deployments,lines,configPath,get state(){return state;},run:(prompt)=>context.configureNodeObservers(prompt,"beta")};
}

test("new-node wizard collects probes, previews them and installs from the same command",async()=>{
  const created=[],installed=[],lines=[];
  const state={stage:"ready",nodes:{alpha:{}}};
  const context=vm.createContext({
    normalizeNodeSpec,validateNodeId,validateSshTarget,InputError,inputValue,choiceValue,displayValue,promptServices,loadState:async()=>state,
    line:(message)=>lines.push(message),fail:(message)=>{throw Error(message);},
    parseServices:()=>[],printObserverSummary,promptAccounting,printAccountingSummary,readNetworkInventory:async()=>({interfaces:["eth0"],defaults:["eth0"]}),
    promptOptionalObservers:async(prompt,options)=>{
      assert.equal(options.state,state);
      assert.equal(options.excludeNodeId,"beta");
      return {
        probes:await promptNetworkProbes(prompt,{line:(message)=>lines.push(message)}),
      };
    },
    createNodeRecords:async(_state,specs)=>created.push(...specs),
    installNode:async(id,ssh)=>installed.push({id,ssh}),
  });
  new vm.Script(["promptSshTarget","addNode"].map(procedure).join("\n")).runInContext(context);
  const prompt=scriptedPrompt([
    ["text","Bad ID",/节点 ID/],["text","alpha",/节点 ID/],["text","beta",/节点 ID/],
    ["text","Beta"],["text","VPS"],["text","Test"],
    ["text","nginx service",/systemd/],["text","",/systemd/],
    ["text","1"],...carrierAnswers,
    ["text","user@host:22",/SSH/],["text","ssh-beta",/SSH/],["text","1",/统计方式/],["text","1",/重置日/],["text","1",/时区/],["yes",true,/以上配置/],
  ]);
  await context.addNode(prompt,new Map());
  assert.deepEqual(created[0].probes,carriers);
  assert.deepEqual(installed,[{id:"beta",ssh:"ssh-beta"}]);
  assert.ok(lines.some(line=>line.includes("网络探针：3")));
  prompt.done();
});

const carrierSteps=(save=true,deploy=true)=>[
  ["yes",false,/显示名/],["yes",false,/systemd/],["text","2",/网络探针/],["text","1",/方式/],...carrierAnswers,
  ["yes",false,/流量/],["yes",save,/保存/],...(save?[["yes",deploy,/部署/]]:[]),
];

test("configuration wizard adds three carriers, preserves services, previews and deploys", async()=>{
  const h=configurationHarness({});
  const prompt=scriptedPrompt(carrierSteps());
  await h.run(prompt);
  const saved=JSON.parse(h.files.get(h.configPath));
  assert.deepEqual(saved.probes,carriers);
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
  await h.run(scriptedPrompt(carrierSteps(false)));
  assert.deepEqual(h.writes,[]);
  assert.deepEqual(h.deployments,[]);
});

test("pending configuration can be deployed from the wizard even when nothing changes",async()=>{
  const h=configurationHarness({pending:true,configured:true});
  await h.run(scriptedPrompt([["yes",false,/显示名/],["yes",false],["text","1"],["yes",false,/流量/],["yes",true,/部署/]]));
  assert.deepEqual(h.writes,[]);
  assert.deepEqual(h.deployments,["beta"]);
});

test("saving for later or a failed sudo deployment retains the selected probes and pending status",async()=>{
  for(const failDeploy of [false,true]) {
    const h=configurationHarness({failDeploy});
    const run=h.run(scriptedPrompt(carrierSteps(true,failDeploy)));
    if(failDeploy)await assert.rejects(run,/sudo/);else await run;
    assert.equal(h.state.nodes.beta.pendingApply,true);
    assert.deepEqual(JSON.parse(h.files.get(h.configPath)).probes,carriers);
  }
});

test("cancelling an accidentally added second probe preserves the completed first probe", async () => {
  const prompt = scriptedPrompt([
    ["text","3"], ["text","a.example"], ["text",""], ["text",""],
    ["yes",true], ["text","/cancel"],
  ]);
  const probes = await promptNetworkProbes(prompt, { line:()=>{} });
  assert.equal(probes.length, 1);
  assert.equal(probes[0].target, "a.example");
  prompt.done();
});

test("back revisits the previous field and keeps its answer", async () => {
  const prompt = scriptedPrompt([
    ["text","3"], ["text","a.example"], ["text","/back",/端口/], ["text","",/公网网址/], ["text","8443",/端口/], ["text",""],
  ]);
  const [probe] = await promptNetworkProbes(prompt, { existing:[site("site","1.1.1.1")], line:()=>{} });
  assert.equal(probe.target, "a.example");
  assert.equal(probe.port, 8443);
  prompt.done();
});

test("cancelling or skipping a replacement retains existing probes; explicit deletion still works", async () => {
  for (const create of [async()=>[], async()=>{throw new PromptCancelled();}]) {
    const result = await editObserverEntries(scriptedPrompt([["text","3"]]), {label:"探针", entries:carriers, limit:32, create, line:()=>{}});
    assert.deepEqual(result, carriers);
  }
  const result = await editObserverEntries(scriptedPrompt([["text","4"],["text","1,2,3"]]), {label:"探针", entries:carriers, limit:32, create:()=>assert.fail(), line:()=>{}});
  assert.deepEqual(result, []);
});

test("cancelling a node configuration before preview saves nothing", async () => {
  const h = configurationHarness({});
  await assert.rejects(h.run(scriptedPrompt([["yes",false,/显示名/],["yes",false],["text","/cancel"]])), PromptCancelled);
  assert.deepEqual(h.writes, []);
  assert.deepEqual(h.deployments, []);
});

test("node configuration saves selected interfaces and the traffic cycle without changing existing services or probes",async()=>{
 const h=configurationHarness({configured:true});
 const prompt=scriptedPrompt([["yes",false,/显示名/],["yes",false,/systemd/],["text","1",/网络探针/],["yes",true,/流量/],["text","2",/统计方式/],["text","2",/网卡编号/],["text","15",/重置日/],["text","2",/时区/],["yes",true,/保存/],["yes",false,/部署/]]);
 await h.run(prompt);const config=JSON.parse(h.files.get(h.configPath));
 assert.deepEqual(config.network_interfaces,["eth1"]);assert.deepEqual(config.traffic_cycle,{reset_day:15,time_zone:"Asia/Shanghai"});
 assert.deepEqual(config.services,[{name:"nginx.service"}]);assert.deepEqual(config.probes,carriers);assert.equal(config.secret,"beta-secret");assert.equal(h.state.nodes.beta.pendingApply,true);prompt.done();
});

test("node configuration can rename the panel display, role and region without touching secrets or probes", async () => {
  const h = configurationHarness({ configured: true });
  const prompt = scriptedPrompt([
    ["yes", true, /显示名/],
    ["text", "x".repeat(81), /面板显示名/], ["text", "香港 01", /面板显示名/],
    ["text", "", /用途/], ["text", "香港", /国家/],
    ["yes", false, /systemd/], ["text", "1", /网络探针/], ["yes", false, /流量/],
    ["yes", true, /保存/], ["yes", false, /部署/],
  ]);
  await h.run(prompt);
  const config = JSON.parse(h.files.get(h.configPath));
  assert.deepEqual(
    { name: config.node.display_name, role: config.node.role, region: config.node.region },
    { name: "香港 01", role: "VPS", region: "香港" },
  );
  assert.equal(config.secret, "beta-secret");
  assert.deepEqual(config.probes, carriers);
  assert.ok(h.lines.some((line) => line.includes("输入无效")));
  assert.ok(h.lines.some((line) => line.includes("面板显示：香港 01 · VPS · 香港")));
  assert.equal(h.state.nodes.beta.pendingApply, true);
  prompt.done();
});

test("declining the display prompt leaves the node display untouched", async () => {
  const node = { id: "beta", display_name: "Beta", role: "中转", region: "东京" };
  const prompt = scriptedPrompt([["yes", false, /显示名/]]);
  assert.equal(await promptNodeDisplay(prompt, node, { line: () => {} }), false);
  assert.deepEqual(node, { id: "beta", display_name: "Beta", role: "中转", region: "东京" });
  prompt.done();
});
