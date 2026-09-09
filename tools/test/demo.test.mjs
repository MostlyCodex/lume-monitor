import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { demoHtml } from "../build-demo.mjs";
import { createDemoData } from "../../worker/public/demo/data.js";

test("demo keeps assets within a Pages subpath and separates browser preferences", async () => {
  const template = await readFile(new URL("../../worker/public/dashboard/index.html", import.meta.url), "utf8");
  const html = demoHtml(template, "./dashboard/");
  assert.match(html, /data-demo="true"/);
  assert.doesNotMatch(html, /(?:src|href)="\/dashboard\//);
  assert.match(html, /公开演示 · 虚构数据/);
  assert.match(html, /id="logout-button"[^>]*hidden/);
});

test("demo history is generated locally for both overview and node details", () => {
  const data = createDemoData(1_750_000_000);
  const latest = data.latestData();
  assert.equal(latest.nodes.length, 6);
  const overview = data.historyData(24, null);
  const detail = data.historyData(168, "transit-la");
  assert.ok(overview.probes.length > 0);
  assert.ok(detail.probes.every((probe) => probe.node_id === "transit-la"));
  assert.ok(detail.counters.length > 0);
  assert.equal(detail.server_time, latest.server_time);
  assert.ok(!JSON.stringify(latest).includes('"secret"'));
});
