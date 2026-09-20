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
async function pointAtChart(page, testInfo) {
  const host = page.locator("#network-plot");
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

test("failure-only histories retain tooltips and selection works with duplicate labels", async ({ page }, testInfo) => {
  const label = '<img src=x onerror="window.injected=true">';
  await page.route("**/api/v1/dashboard/latest*", async (route) => {
    const response = await route.fetch(), data = await response.json();
    for (const node of data.nodes) for (const probe of node.probes) probe.label = label;
    // The catalog supplies the display metadata used by the dashboard.
    for (const probe of data.catalog.probes ?? []) probe.label = label;
    await route.fulfill({ response, json: data });
  });
  await page.route("**/api/v1/dashboard/history?*", async (route) => {
    const response = await route.fetch(), data = await response.json();
    for (const row of data.probes) Object.assign(row, {
      latency_ms: null, packet_loss_percent: 100, sample_failure_percent: 100,
    });
    await route.fulfill({ response, json: data });
  });
  await page.goto(`${origin}/dashboard/`, { waitUntil: "networkidle" });
  await page.locator(".node-card").first().click();
  await expect(page.locator("#network-plot canvas")).toBeVisible();
  await expect(page.locator("#network-chart-state")).toHaveCount(0);
  const tooltip = await pointAtChart(page, testInfo);
  await expect(tooltip.locator(".plot-tooltip-row")).toHaveCount(5);
  await expect(tooltip).toContainText("100%");
  await expect(tooltip).toContainText("建连失败");
  await expect(tooltip).toContainText(label);
  await expect(tooltip.locator("img")).toHaveCount(0);
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  await page.locator('[data-probe-action="none"]').click();
  await expect(page.locator("#network-empty")).toBeVisible();
  await expect(page.locator("#network-plot canvas")).toHaveCount(0);
  await page.locator(".detail-probe-card").last().click();
  await expect(page.locator("#network-plot canvas")).toBeVisible();
  await pointAtChart(page, testInfo);
  await expect(tooltip.locator(".plot-tooltip-row")).toHaveCount(1);
  await expect(tooltip).toContainText("建连失败");
  await expect(tooltip).toContainText("100%");
  await expect(tooltip).toContainText("—");
  await page.locator('[data-network-layer="latency"]').click();
  await expect(page.locator('[data-network-layer="loss"]')).toHaveAttribute("aria-pressed", "true");
  await pointAtChart(page, testInfo);
  await expect(tooltip).toContainText("100%");
  await page.locator("#theme-button").click();
  await pointAtChart(page, testInfo);
  await expect(tooltip).toContainText("100%");
});
