import { expect, test } from "@playwright/test";
import { startPreviewServer } from "../dashboard-preview-server.mjs";
let server, origin;
test.beforeAll(async () => {
  server = await startPreviewServer(0);
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});
async function pointAtChart(page, testInfo, id = "#loss-plot") {
  const host = page.locator(id);
  await host.scrollIntoViewIfNeeded();
  const box = await host.boundingBox();
  const x = box.x + box.width * .6, y = box.y + box.height * .7;
  if (testInfo.project.use.hasTouch) await page.touchscreen.tap(x, y);
  else await page.mouse.move(x, y);
  const tooltip = host.locator(".plot-tooltip");
  await expect(tooltip).toBeVisible();
  const bounds = await tooltip.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(box.x);
  expect(bounds.y).toBeGreaterThanOrEqual(box.y);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(box.y + box.height + 1);
  return tooltip;
}

test("failure-only histories keep the loss chart and selection works with duplicate labels", async ({ page }, testInfo) => {
  const label = '<img src=x onerror="window.injected=true">';
  await page.route("**/api/v1/dashboard/latest*", async (route) => {
    const response = await route.fetch(), data = await response.json();
    for (const node of data.nodes) for (const probe of node.probes) probe.label = label;
    await route.fulfill({ response, json: data });
  });
  await page.route("**/api/v1/dashboard/history?*", async (route) => {
    const response = await route.fetch(), data = await response.json();
    for (const row of data.probes) Object.assign(row, {
      latency_ms: null, packet_loss_percent: row.packet_loss_percent === null ? null : 100, success_percent: 0,
    });
    await route.fulfill({ response, json: data });
  });
  await page.goto(`${origin}/dashboard/`, { waitUntil: "networkidle" });
  await page.locator(".node-card").first().click();
  // 没有任何成功的延迟样本时延迟图显示空状态，丢包率图照常绘制 4 条 ICMP 线路
  await expect(page.locator("#latency-empty")).toHaveText("暂无延迟历史");
  await expect(page.locator("#loss-plot svg")).toBeVisible();
  const tooltip = await pointAtChart(page, testInfo);
  await expect(tooltip.locator(".plot-tooltip-row")).toHaveCount(4);
  await expect(tooltip).toContainText("100%");
  await expect(tooltip).toContainText(label);
  await expect(tooltip.locator("img")).toHaveCount(0);
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  await page.locator('[data-probe-action="none"]').click();
  await expect(page.locator("#loss-empty")).toHaveText("未选择要显示的线路");
  await expect(page.locator("#loss-plot svg")).toHaveCount(0);
  await page.locator(".detail-probe-card").first().click();
  await expect(page.locator("#loss-plot svg")).toBeVisible();
  await pointAtChart(page, testInfo);
  await expect(tooltip.locator(".plot-tooltip-row")).toHaveCount(1);
  await expect(tooltip).toContainText("100%");
  await page.locator("#theme-button").click();
  await pointAtChart(page, testInfo);
  await expect(tooltip).toContainText("100%");
});
