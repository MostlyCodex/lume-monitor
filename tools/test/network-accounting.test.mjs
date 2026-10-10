import assert from "node:assert/strict";
import test from "node:test";
import {configFingerprint, configurationStatus, matchesAppliedReport, normalizeAccounting, parseNetworkInventory, promptAccounting, serializeAgentConfig} from "../network-accounting.mjs";
import {PromptCancelled} from "../prompts.mjs";
import {applyPending} from "../management.mjs";

function prompt(answers) {
 const remaining=[...answers],messages=[];
 return {messages,text:async(question,fallback,{hint}={})=>{
  const step=remaining.shift();assert.ok(step,question);assert.equal(step[0],"text",question);messages.push([question,hint]);return step[1] || fallback;
 },yes:async(question)=>{const step=remaining.shift();assert.ok(step,question);assert.equal(step[0],"yes",question);return step[1];},done:()=>assert.equal(remaining.length,0)};
}
const inventory={interfaces:["eth0","eth1","wg0"],defaults:["eth0"]};

test("accounting defaults to a monthly UTC cycle and invalid monitored values are rejected",()=>{
 assert.deepEqual(normalizeAccounting(),{network_interfaces:[],traffic_cycle:{reset_day:1,time_zone:"UTC"}});
 // 旧配置的 enabled 开关已废弃，读取时丢弃，周期统计始终开启
 assert.deepEqual(normalizeAccounting({traffic_cycle:{enabled:false,reset_day:5,time_zone:"UTC"}}),{network_interfaces:[],traffic_cycle:{reset_day:5,time_zone:"UTC"}});
 for (const value of [{network_interfaces:["lo"]},{network_interfaces:["eth0","eth0"]},{network_interfaces:["../x"]},{traffic_cycle:{reset_day:32}},{traffic_cycle:{reset_day:1.5}},{traffic_cycle:{time_zone:"local"}}]) assert.throws(()=>normalizeAccounting(value));
});
test("SSH inventory selects the best route without offering loopback",()=>{
 const raw="lo: "+"0 ".repeat(16)+"\neth0: "+"1 ".repeat(16)+"\neth1: "+"2 ".repeat(16)+"\nLUME_ROUTES4\neth1 00000000 01000000 0003 0 0 200 00000000\neth0 00000000 01000000 0003 0 0 100 00000000\nLUME_ROUTES6\n";
 assert.deepEqual(parseNetworkInventory(raw),{interfaces:["eth0","eth1"],defaults:["eth0"]});
 assert.throws(()=>parseNetworkInventory("permission denied"),/不完整/);
});
test("interface, reset-day and timezone prompts retry invalid input before accepting selections",async()=>{
 const dialog=prompt([["text","3"],["text","2"],["text","4"],["text","1,1"],["text","1,2"],["text","0"],["text","32"],["text","1.5"],["text","31"],["text","9"],["text","2"]]);
 const messages=[];const value=await promptAccounting(dialog,{}, {discover:async()=>inventory,line:message=>messages.push(message)});
 assert.deepEqual(value,{network_interfaces:["eth0","eth1"],traffic_cycle:{reset_day:31,time_zone:"Asia/Shanghai"}});
 assert.equal(messages.filter(message=>message.startsWith("输入无效")).length,7);
 assert.ok(dialog.messages.some(([,hint])=>hint?.includes("1–31")));
 dialog.done();
});
test("ambiguous automatic interfaces require an explicit selection and cancellation performs no mutation",async()=>{
 const original={network_interfaces:[],traffic_cycle:{reset_day:1,time_zone:"UTC"}};
 const dialog=prompt([["text","1"],["text","2"],["text","2"],["text",""],["text",""]]);
 const value=await promptAccounting(dialog,original,{discover:async()=>({...inventory,defaults:["eth0","eth1"]}),line:()=>{}});
 assert.deepEqual(value.network_interfaces,["eth1"]);assert.deepEqual(original.network_interfaces,[]);dialog.done();
 await assert.rejects(promptAccounting(prompt([["text","/cancel"]]),original,{line:()=>{}}),PromptCancelled);
});
test("configuration acknowledgement requires exact content, a fresh sample, and the requested Agent version",()=>{
 const config={node:{id:"a"},secret:"fixture-secret",services:[],probes:[]};
 const body=serializeAgentConfig(config);const fingerprint=configFingerprint(body);
 assert.equal(fingerprint.length,64);assert.notEqual(configFingerprint(body+" "),fingerprint);
 const expected={fingerprint,since:100,version:"1.0.0"};
 const applied={config_fingerprint:fingerprint,last_report_at:110,generated_at:105,agent_version:"1.0.0"};
 assert.ok(matchesAppliedReport(applied,expected));
 for (const change of [{config_fingerprint:"0".repeat(64)},{generated_at:99},{generated_at:null},{last_report_at:99},{agent_version:"0.9.0"}]) assert.equal(matchesAppliedReport({...applied,...change},expected),false);
 assert.equal(configurationStatus({},applied,fingerprint),"配置已生效");
 assert.match(configurationStatus({applyError:true},{},fingerprint),/失败/);
 assert.match(configurationStatus({pendingConfirmation:true},{},fingerprint),/待启动/);
 assert.match(configurationStatus({},null,fingerprint,{available:false}),/不可达/);
 assert.match(configurationStatus({},null,undefined),/待核验/);
});
test("an inactive deployment remains pending until an Agent acknowledges it",async()=>{
 const state={nodes:{a:{}}};await applyPending(state,["a"],{save:async()=>{},deploy:async()=>false});assert.equal(state.nodes.a.pendingApply,true);
 await assert.rejects(applyPending(state,["a"],{save:async()=>{},deploy:async()=>{throw Error("failed");}}));assert.equal(state.nodes.a.applyError,true);
 await applyPending(state,["a"],{save:async()=>{},deploy:async()=>true});assert.equal(state.nodes.a.pendingApply,undefined);assert.equal(state.nodes.a.applyError,undefined);
});


test("status distinguishes an old Worker, a missing Agent report, and an unsupported Agent",()=>{
 const fingerprint="a".repeat(64);
 const reported={last_report_at:100,generated_at:100};
 assert.equal(configurationStatus({},reported,fingerprint,{supportsFingerprint:false}),"配置待核验（Worker 尚不支持配置核验）");
 assert.equal(configurationStatus({},null,fingerprint,{supportsFingerprint:true}),"配置待核验（尚未收到 Agent 上报）");
 assert.equal(configurationStatus({},reported,fingerprint,{supportsFingerprint:true}),"配置待核验（Agent 未上报配置摘要）");
 assert.equal(configurationStatus({pendingApply:true},reported,fingerprint,{supportsFingerprint:false}),"配置待部署");
 assert.equal(configurationStatus({},null,fingerprint,{available:false,supportsFingerprint:false}),"配置无法核验（后端不可达）");
});


test("deployment normalizes saved node metadata without changing monitoring settings",()=>{
 const config={node:{id:"alpha",display_name:"Alpha",role:"VPS",group:"default",region:"Test",stale_seconds:180,display_order:10,color:"blue",offline_severity:"P1",ip_change_severity:"P2",obsolete_badge:"OLD"},secret:"fixture-secret",services:[{name:"nginx.service"}],
  probes:[{name:"wan",kind:"icmp",target:"example.com",warning_failure_percent:1,primary:true},{name:"web",kind:"tcp",target:"example.com",port:443,warning_failure_percent:1,critical_failure_percent:60}],network_interfaces:["eth0"]};
 const normalized=JSON.parse(serializeAgentConfig(config));
 assert.deepEqual(normalized.node,{id:"alpha",display_name:"Alpha",role:"VPS",region:"Test",stale_seconds:180,display_order:10,ip_change_severity:"P2"});
 assert.deepEqual(normalized.services,config.services);
 // Probes keep only the current Agent fields; TCP probes carry no packet-loss thresholds.
 assert.deepEqual(normalized.probes,[{name:"wan",kind:"icmp",target:"example.com",warning_failure_percent:1},{name:"web",kind:"tcp",target:"example.com",port:443}]);
 assert.equal(normalized.secret,config.secret);
 assert.equal(config.node.obsolete_badge,"OLD");
 assert.equal(serializeAgentConfig(normalized),serializeAgentConfig(config));
});
