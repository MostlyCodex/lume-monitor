import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import { createRemoteChangeLog, formatRemoteChange, parseRemoteChanges } from "../remote-changes.mjs";
import { divider, terminalFor } from "../terminal-output.mjs";
import { PromptCancelled, PromptClosed } from "../prompts.mjs";

const report = rows => ["LUME_CHANGES_V1", ...rows, "END", ""].join("\n");
test("remote change summaries distinguish current, deleted, binary and link locations without file contents", () => {
  const rows = parseRemoteChanges(report([
    "changed\t/etc/vpsmon/config.json\ttext\t2,5\t2",
    "added\t/etc/systemd/system/vpsmon-agent.service\ttext\t-\t1-44",
    "removed\t/etc/systemd/system/vpsmon-nftables-snapshot.timer\ttext\t1-8\t-",
    "changed\t/opt/vpsmon/vpsmon-agent\tbinary\t-\t-",
    "removed\t/etc/systemd/system/multi-user.target.wants/vpsmon-agent.service\tlink\t-\t-",
    "service\tvpsmon-agent.service\tactive/enabled\tinactive/disabled",
  ]));
  assert.deepEqual(rows.map(formatRemoteChange), [
    "  更新  /etc/vpsmon/config.json:2（原行 2,5）",
    "  新增  /etc/systemd/system/vpsmon-agent.service:1-44",
    "  删除  /etc/systemd/system/vpsmon-nftables-snapshot.timer（原行 1-8）",
    "  更新  /opt/vpsmon/vpsmon-agent（二进制，无行号）",
    "  删除  /etc/systemd/system/multi-user.target.wants/vpsmon-agent.service（符号链接）",
    "  服务  vpsmon-agent.service  active/enabled → inactive/disabled",
  ]);
});

test("invalid or incomplete remote output is never presented as a verified change report", () => {
  for (const value of ["LUME_CHANGES_V1\n", report(["added\t/etc/shadow\ttext\t-\t1"]), report(["changed\t/etc/vpsmon/config.json\ttext\tsecret-value\t1"])]) assert.throws(() => parseRemoteChanges(value));
  const messages=[], log=createRemoteChangeLog(value=>messages.push(value));
  log.record("fixture", "private-secret-marker");
  log.record("fixture", report([]));
  log.flush();
  assert.ok(messages.some(value=>value.includes("未取回完整")));
  assert.ok(messages.some(value=>value.includes("未发现受管文件")));
  assert.ok(!messages.join().includes("private-secret-marker"));
  const count=messages.length; log.flush(); assert.equal(messages.length,count);
});

test("terminal boundaries coalesce and resume after new content", () => {
  const output=new PassThrough(); let text=""; output.on("data",chunk=>text+=chunk);
  const terminal=terminalFor(output);
  assert.equal(terminalFor(output),terminal);
  terminal.separate(); assert.equal(text,"");
  terminal.line("完成"); terminal.separate(); terminal.separate();
  terminal.line("下一项"); terminal.separate();
  assert.equal(text,`完成\n${divider}\n下一项\n${divider}\n`);
});

const source = await readFile(new URL("../lumectl.mjs", import.meta.url), "utf8");
function procedure(name) {
  const start=source.indexOf(`async function ${name}(`);
  assert.ok(start>=0);
  const remaining=source.slice(start), next=remaining.slice(1).search(/\n(?:async )?function /);
  return next<0?remaining:remaining.slice(0,next+1);
}

test("menu outcomes always finish a block before returning, including failure and cancellation", async () => {
  for (const outcome of [null,new Error("failed"),new PromptCancelled(),new PromptClosed()]) {
    const events=[],choices=["3","0"];
    const context=vm.createContext({
      line:value=>events.push(value), choiceValue:async()=>choices.shift(),
      showStatus:async()=>{events.push("operation");if(outcome)throw outcome;},
      finishOperation:()=>events.push("separator"), PromptCancelled, PromptClosed,
    });
    new vm.Script(procedure("manage")).runInContext(context);
    await context.manage({});
    assert.equal(events.filter(value=>value==="separator").length,1);
    const separator=events.indexOf("separator");
    assert.ok(separator>events.indexOf("operation"));
    if (!(outcome instanceof PromptClosed)) assert.ok(events.slice(separator+1).some(value=>value.includes("Lume 管理")));
  }
});

test("failed remote operations still retrieve their actual changes without masking the original error", async () => {
  for (const retrievalFails of [false,true]) {
    const events=[], original=new Error("remote action failed");
    const context=vm.createContext({
      run:async(_command,_args,options)=>{
        if(options.interactive)throw original;
        events.push("read-report");
        if(retrievalFails)throw Error("connection lost");
        return {code:0,stdout:report([])};
      },
      remoteChanges:{record:()=>events.push("recorded"),unavailable:()=>events.push("unavailable")},
    });
    new vm.Script(procedure("runAgentOperation")).runInContext(context);
    await assert.rejects(context.runAgentOperation("fixture","/tmp/vpsmon-stage.fixture","upgrade"),error=>error===original);
    assert.deepEqual(events,["read-report",retrievalFails?"unavailable":"recorded"]);
  }
});
