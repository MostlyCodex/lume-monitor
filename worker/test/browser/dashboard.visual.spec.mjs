import { expect, test } from "@playwright/test";
import { startPreviewServer } from "../dashboard-preview-server.mjs";

const FIXED_TIME = new Date("2026-08-24T12:00:00.000Z");
let previewServer;
let previewOrigin;

test.beforeAll(async () => {
  previewServer = await startPreviewServer(0);
  const address = previewServer.address();
  previewOrigin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  previewServer.closeAllConnections?.();
  await new Promise((resolve) => previewServer.close(resolve));
});

async function openDashboard(page) {
  await page.clock.install({ time: FIXED_TIME });
  await page.goto(`${previewOrigin}/dashboard/`, { waitUntil: "networkidle" });
  await expect(page.locator("#loading-view")).toBeHidden();
  await expect(page.locator("#dashboard-view")).toBeVisible();
  await expect(page.locator(".node-card")).toHaveCount(6);
}

async function expectNoHorizontalOverflow(page) {
  const geometry = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport + 1);
  expect(geometry.bodyWidth).toBeLessThanOrEqual(geometry.viewport + 1);
}

async function expectGlassMaterial(page, selector) {
  const material = await page.locator(selector).first().evaluate((element) => {
    const style = getComputedStyle(element);
    const match = style.backgroundColor.match(/rgba?\(([^)]+)\)/);
    const components = match ? match[1].split(/[ ,/]+/).filter(Boolean).map(Number) : [];
    return {
      connected: element.isConnected,
      backdrop: style.getPropertyValue("backdrop-filter") || style.getPropertyValue("-webkit-backdrop-filter"),
      alpha: components.length >= 4 ? components[3] : 1,
    };
  });
  expect(material.connected).toBe(true);
  expect(material.backdrop).toContain("blur(");
  expect(material.alpha).toBeLessThan(0.8);
}

async function attachScreenshot(page, testInfo, name) {
  await testInfo.attach(name, {
    body: await page.screenshot({ fullPage: true, animations: "disabled" }),
    contentType: "image/png",
  });
}

test("fleet page keeps its visual and responsive contract", async ({ page }, testInfo) => {
  await openDashboard(page);
  await expectNoHorizontalOverflow(page);

  const viewportWidth = page.viewportSize().width;
  for (const selector of [".command-bar", ".dashboard-footer"]) {
    const box = await page.locator(selector).boundingBox();
    expect(box.x).toBeLessThanOrEqual(1);
    expect(box.width).toBeGreaterThanOrEqual(viewportWidth - 1);
  }

  await expect(page.locator('.node-flag[aria-label="JP"] svg')).toBeVisible();
  await expectGlassMaterial(page, ".node-card");
  await expectGlassMaterial(page, ".command-bar");

  const markers = await page.locator(".node-card").first().locator(".resource-gauge-marker").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("cx")));
  expect(new Set(markers).size).toBe(3);

  const firstCard = page.locator(".node-card").first();
  await firstCard.focus();
  const outlineWidth = await firstCard.evaluate((element) => parseFloat(getComputedStyle(element).outlineWidth));
  expect(outlineWidth).toBeGreaterThanOrEqual(2);

  if (testInfo.project.name === "mobile-390" || testInfo.project.name === "tablet-768") {
    const controls = page.locator("#refresh-button, #theme-button, #settings-button");
    for (let index = 0; index < await controls.count(); index += 1) {
      const box = await controls.nth(index).boundingBox();
      expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
    }
  }

  await attachScreenshot(page, testInfo, `${testInfo.project.name}-fleet-dark`);

  await page.locator("#theme-button").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expectGlassMaterial(page, ".node-card");
  await expectNoHorizontalOverflow(page);
  await attachScreenshot(page, testInfo, `${testInfo.project.name}-fleet-light`);
});

test("node detail renders charts, color keys and mobile controls", async ({ page }, testInfo) => {
  await openDashboard(page);
  await page.locator(".node-card").first().click();
  await expect(page.locator("#node-detail")).toBeVisible();
  await expect(page.locator("#network-plot .uplot")).toBeVisible();
  await expect(page.locator("#traffic-plot .uplot")).toBeVisible();
  await expect(page.locator(".detail-probe-card")).toHaveCount(4);
  await expectNoHorizontalOverflow(page);
  await expectGlassMaterial(page, ".chart-card");

  const swatches = await page.locator(".detail-probe-swatch").evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).backgroundColor));
  expect(new Set(swatches).size).toBe(4);

  const selected = page.locator(".detail-probe-card").first();
  await page.keyboard.press("Tab");
  await selected.focus();
  const outlineWidth = await selected.evaluate((element) => parseFloat(getComputedStyle(element).outlineWidth));
  expect(outlineWidth).toBeGreaterThanOrEqual(2);

  if (testInfo.project.name === "mobile-390") {
    await expect(page.locator(".detail-probe-card").first().locator('span[title="平均延迟"]')).toBeHidden();
    const rangeButtons = page.locator("#detail-range-switch button");
    for (let index = 0; index < await rangeButtons.count(); index += 1) {
      const box = await rangeButtons.nth(index).boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(40);
    }
  }

  await attachScreenshot(page, testInfo, `${testInfo.project.name}-detail-dark`);
});
