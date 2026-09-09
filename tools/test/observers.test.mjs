import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import vm from "node:vm";
import test from "node:test";
import { normalizeNodeSpec, validateNodeId, validateSshTarget } from "../lumectl.mjs";
import { InputError, choiceValue, displayValue, inputValue } from "../prompts.mjs";
import {
  createCarrierProbes, editObserverEntries, externalProbes, mergeObserverEntries,
  printObserverSummary, probeTarget, promptNetworkProbes, promptNftablesCounters, promptServices, selectedIndices,
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
  const probes = await promptNetworkProbes(prompt,{nodes:["beta"],line:()=>{}});
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

test("custom probe retries each invalid field while preserving previous choices", async () => {
  const prompt = scriptedPrompt([
    ["text","9",/方式/],["text","3",/方式/],["yes",true],
    ["text","udp",/类型/],["text","TCP",/类型/],
    ["text","Bad Name",/探针名称/],["text",carriers[0].name,/探针名称/],["text","web_tcp",/探针名称/],
    ["text","网站连接"],
    ["text","https://web.example",/目标主机/],["text","999.1.1.1",/目标主机/],["text","web.example",/目标主机/],
    ["text","65536",/端口/],["text","1.5",/端口/],["text","443",/端口/],
    ["text","missing",/目标节点/],["text","beta",/目标节点/],["yes",false],
  ]);
  const errors = [];
  const probes = await promptNetworkProbes(prompt, { existing:carriers, nodes:["beta"], line:(message)=>errors.push(message) });
  assert.equal(probes[0].name,"web_tcp");
  assert.equal(probes[0].target,"web.example");
  assert.equal(probes[0].port,443);
  assert.equal(probes[0].target_node_id,"beta");
  assert.equal(errors.filter(message=>message.startsWith("输入无效")).length,9);
  assert.equal(prompt.questions.filter(question=>question.startsWith("面板显示名")).length,1);
  prompt.done();
});

test("carrier prefix and each target retry locally, including generated label byte limits",async()=>{
  const prompt=scriptedPrompt([
    ["text","1"],["text","北".repeat(23),/目标地区/],["text","北".repeat(22),/目标地区/],
    ["text","carrier",/前缀/],["text","x".repeat(78),/前缀/],["text","new",/前缀/],
    ["text","192.0.2.1:80",/电信/],["text","192.0.2.1",/电信/],
    ["text","unicom.example"],["text","2001:db8::1"],["yes",false],
  ]);
  const probes=await promptNetworkProbes(prompt,{existing:carriers,line:()=>{}});
  assert.deepEqual(probes.map(probe=>probe.name),["new_ct","new_cu","new_cm"]);
  assert.ok(probes.every(probe=>Buffer.byteLength(probe.label)===80));
  prompt.done();
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

test("nftables retries every constrained field without recreating previous counters",async()=>{
  const existing=[{name:"hits"}];
  const prompt=scriptedPrompt([
    ["yes",true],["text","hits",/计数器名称/],["text","rule_hits",/计数器名称/],["text","规则命中"],
    ["text","bridge",/family/],["text","inet",/family/],
    ["text","table bad",/table/],["text","filter",/table/],
    ["text","x".repeat(65),/chain/],["text","input",/chain/],
    ["text","icmp",/协议/],["text","udp",/协议/],
    ["text","0",/端口/],["text","65535",/端口/],
    ["text","汉".repeat(27),/comment/],["text","exact-rule",/comment/],["yes",false],
  ]);
  const counters=await promptNftablesCounters(prompt,{existing,line:()=>{}});
  assert.equal(counters[0].name,"rule_hits");
  assert.equal(counters[0].family,"inet");
  assert.equal(counters[0].protocol,"udp");
  assert.equal(counters[0].destination_port,65535);
  assert.equal(counters[0].rule_comment,"exact-rule");
  assert.deepEqual(existing,[{name:"hits"}]);
  prompt.done();
});

test("reuse retries invalid indices, capacity overflow and name conflicts before accepting probes",async()=>{
  const existing=Array.from({length:31},(_,index)=>({...carriers[0],name:`existing_${index}`}));
  const prompt=scriptedPrompt([
    ["text","2"],["text","2",/节点编号/],["text","1",/节点编号/],
    ["text","4",/哪些探针/],["text","1,2",/哪些探针/],["text","3",/哪些探针/],
  ]);
  const probes=await promptNetworkProbes(prompt,{sources:[sourceNode],existing,line:()=>{}});
  assert.deepEqual(probes,[carriers[2]]);
  assert.equal(existing.length,31);
  prompt.done();
  const conflicting=scriptedPrompt([["text","2"],["text","1"],["text","1"],["text","2"],["yes",false]]);
  const selected=await promptNetworkProbes(conflicting,{sources:[sourceNode],existing:[{...carriers[0],target:"changed.example"}],line:()=>{}});
  assert.deepEqual(selected,[carriers[1]]);
  conflicting.done();
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
  const counters=[{name:"hits",label:"Rule hits",family:"inet",table:"filter",chain:"input",protocol:"tcp",destination_port:443}];
  const config={node:{id:"beta"},secret:"beta-secret",services:[{name:"nginx.service"}],probes:configured?structuredClone(carriers):[],nftables_counters:counters};
  const files=new Map([[configPath,JSON.stringify(config)],[sourcePath,JSON.stringify({node:{id:"alpha"},secret:"source-secret",probes:carriers})]]);
  const writes=[],deployments=[],lines=[];
  const context=vm.createContext({
    Object,JSON,Date,join,privateDir,statePath,validateNodeId,InputError,inputValue,choiceValue,displayValue,
    editObserverEntries,externalProbes,printObserverSummary,promptNetworkProbes,promptNftablesCounters,promptServices,
    line:(message)=>lines.push(message),fail:(message)=>{throw Error(message);},assertPlainObject:()=>{},
    loadState:async()=>structuredClone(state),exists:async(path)=>files.has(path),
    lstat:async()=>({isFile:()=>true,isSymbolicLink:()=>false}),
    readFile:async(path)=>{if(!files.has(path))throw Error("missing fixture");return files.get(path);},
    writePrivateJson:async(path,value)=>{writes.push(path);if(path===statePath)state=structuredClone(value);else files.set(path,JSON.stringify(value));},
    applyNodes:async(_prompt,ids)=>{deployments.push(...ids);if(failDeploy)throw Error("sudo password required");state.nodes.beta.pendingApply=false;},
  });
  new vm.Script(["probeTargetNodes","availableProbeSources","configureNodeObservers"].map(procedure).join("\n")).runInContext(context);
  return {files,writes,deployments,lines,configPath,counters,get state(){return state;},run:(prompt)=>context.configureNodeObservers(prompt,"beta")};
}

test("new-node wizard collects probes, previews them and installs from the same command",async()=>{
  const created=[],installed=[],lines=[];
  const state={stage:"ready",nodes:{alpha:{}}};
  const context=vm.createContext({
    normalizeNodeSpec,validateNodeId,validateSshTarget,InputError,inputValue,choiceValue,displayValue,promptServices,loadState:async()=>state,
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
  new vm.Script(["promptSshTarget","addNode"].map(procedure).join("\n")).runInContext(context);
  const prompt=scriptedPrompt([
    ["text","Bad ID",/节点 ID/],["text","alpha",/节点 ID/],["text","beta",/节点 ID/],
    ["text","Beta"],["text","VPS"],["text","Test"],["text","five5",/短标记/],["text","B",/短标记/],
    ["text","nginx service",/systemd/],["text","",/systemd/],
    ["text","2"],["text","1"],["text",""],["yes",false],["yes",false],
    ["text","user@host:22",/SSH/],["text","ssh-beta",/SSH/],["yes",true,/以上配置/],
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
