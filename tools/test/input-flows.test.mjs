import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";
import test from "node:test";
import { validateDatabaseName, validateNodeId, validateSshTarget, validateWorkerName } from "../lumectl.mjs";
import { InputError, choiceValue, displayValue, inputValue } from "../prompts.mjs";

const source = await readFile(new URL("../lumectl.mjs", import.meta.url), "utf8");
function procedure(name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  const remaining = source.slice(start);
  const next = remaining.slice(1).search(/\n(?:export )?(?:async )?function /);
  return next < 0 ? remaining : remaining.slice(0, next + 1);
}

function dialog(steps) {
  const pending = [...steps], questions = [];
  const answer = async (kind, question) => {
    const step = pending.shift();
    assert.ok(step, `unexpected prompt: ${question}`);
    assert.equal(step[0], kind, question);
    assert.match(question, step[2]);
    questions.push(question);
    return step[1];
  };
  return { text:(question,_fallback,{hint}={})=>answer("text",hint?`${question}（${hint}）`:question), yes:(question)=>answer("yes",question), questions, done:()=>assert.equal(pending.length,0) };
}

function contextFor(names, dependencies = {}) {
  const messages = [];
  const context = vm.createContext({
    Buffer, JSON, Object, InputError, inputValue, choiceValue, displayValue,
    validateNodeId, validateWorkerName, validateDatabaseName, validateSshTarget,
    line:(message)=>messages.push(message), fail:(message)=>{ throw Error(message); },
    ...dependencies,
  });
  new vm.Script(names.map(procedure).join("\n")).runInContext(context);
  return { context, messages };
}

test("fresh setup retries Worker, D1 and bot fields before any external changes", async () => {
  const writes = [];
  const { context, messages } = contextFor(["setup"], {
    doctor:async()=>true, loadState:async()=>null, exists:async()=>false,
    wranglerConfigPath:"memory/wrangler.jsonc", statePath:"memory/state.json",
    randomBytes:(size)=>Buffer.alloc(size,1), randomSecret:()=>"fixture-secret",
    writePrivateJson:async(...args)=>writes.push(args),
  });
  const prompt = dialog([
    ["text","Wrong Name",/Worker 名称/],["text","monitor",/Worker 名称/],
    ["text","bad.db",/D1/],["text","monitor-db",/D1/],
    ["yes",true,/Telegram/],
    ["text","abc",/Bot 用户名/],["text","@monitor_bot",/Bot 用户名/],
    ["yes",false,/确认开始部署/],
  ]);
  await context.setup(prompt,false);
  assert.deepEqual(writes,[]);
  assert.equal(messages.filter(message=>message.startsWith("输入无效")).length,3);
  prompt.done();
});

test("node picker rejects unknown IDs and indices inside the same prompt", async () => {
  const { context } = contextFor(["pickNode"], { loadState:async()=>({nodes:{alpha:{},beta:{}}}) });
  const prompt = dialog([["text","3",/选择节点/],["text","unknown",/选择节点/],["text","beta",/选择节点/]]);
  assert.equal(await context.pickNode(prompt),"beta");
  assert.ok(prompt.questions.every(question=>question.includes("1–2")&&question.includes("alpha / beta")));
  prompt.done();
});

test("only other active nodes are offered as probe targets", () => {
  const { context } = contextFor(["probeTargetNodes"]);
  const ids = context.probeTargetNodes({nodes:{self:{},active:{},retiring:{pendingRetire:true},restoring:{pendingRestore:true}}},"self");
  assert.deepEqual(Array.from(ids),["active"]);
});

test("configuration source and invalid local files retry without printing file contents", async () => {
  const config = {node:{id:"alpha"},secret:"fixture-private-token",services:[],probes:[]};
  const files = new Map([
    [resolve("invalid.json"),'{"secret":"fixture-private-token",'],
    [resolve("different.json"),JSON.stringify({...config,node:{id:"different"}})],
    [resolve("valid.json"),JSON.stringify(config)],
  ]);
  const { context, messages } = contextFor(["promptSshTarget","readNodeConfiguration"], {
    resolve,
    lstat:async(path)=>{ if(!files.has(path)) throw Error("not found"); return {isFile:()=>true,isSymbolicLink:()=>false,size:files.get(path).length}; },
    readFile:async(path)=>files.get(path),
  });
  const prompt = dialog([
    ["text","3",/配置来源/],["text","2",/配置来源/],
    ["text","missing.json",/配置文件路径/],["text","invalid.json",/配置文件路径/],
    ["text","different.json",/配置文件路径/],["text","valid.json",/配置文件路径/],
    ["text","bad host",/SSH/],["text","ops@alpha",/SSH/],
  ]);
  const result = await context.readNodeConfiguration(prompt,"alpha");
  assert.deepEqual(result.config,config);
  assert.equal(result.target,"ops@alpha");
  assert.ok(!messages.join("\n").includes("fixture-private-token"));
  assert.equal(messages.filter(message=>message.startsWith("输入无效")).length,5);
  prompt.done();
});
