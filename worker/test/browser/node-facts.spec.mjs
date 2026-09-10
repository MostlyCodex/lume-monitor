import { expect, test } from "@playwright/test";
import { startPreviewServer } from "../dashboard-preview-server.mjs";

let server;
let origin;

test.beforeAll(async () => {
  server = await startPreviewServer(0);
  origin = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

async function openFirstNode(page) {
  await page.goto(`${origin}/dashboard/`, { waitUntil: "networkidle" });
  await page.locator(".node-card").first().click();
  await expect(page.locator("#detail-facts")).toBeVisible();
}

function factValue(page, label) {
  return page.locator("#detail-facts .detail-fact").filter({ has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }) }).locator("dd");
}

async function expectCompactFacts(page) {
  const geometry = await page.locator("#detail-facts").evaluate((element) => {
    const cells = [...element.children].map((cell) => cell.getBoundingClientRect());
    return {
      firstRowCells: cells.filter((cell) => Math.abs(cell.top - cells[0].top) < 1).length,
      height: element.getBoundingClientRect().height,
      overflowingValues: [...element.querySelectorAll("dd")].filter((value) => value.scrollWidth > value.clientWidth + 1).length,
      pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    };
  });
  expect(geometry.firstRowCells).toBeGreaterThanOrEqual(2);
  expect(geometry.height).toBeLessThan(440);
  expect(geometry.overflowingValues).toBe(0);
  expect(geometry.pageOverflow).toBe(false);
}

test("node facts show hardware capacity in a compact grid in both themes", async ({ page }, testInfo) => {
  await openFirstNode(page);
  await expect(factValue(page, "CPU")).toHaveText("1 vCPU");
  await expect(factValue(page, "内存")).toHaveText("1.00 GiB");
  await expect(factValue(page, "磁盘（/）")).toHaveText("20.00 GiB");
  await expect(page.locator("#detail-facts dt")).toHaveText([
    "系统", "内核", "CPU", "内存", "磁盘（/）", "主机名", "Agent", "采集/发送错误",
  ]);
  for (const theme of ["dark", "light"]) {
    if (theme === "light") await page.locator("#theme-button").click();
    await expectCompactFacts(page);
    await testInfo.attach(`node-facts-${theme}`, {
      body: await page.locator(".info-card").first().screenshot({ animations: "disabled" }),
      contentType: "image/png",
    });
  }
  if (testInfo.project.name === "mobile-390") {
    await page.setViewportSize({ width: 375, height: 812 });
    await expectCompactFacts(page);
    await page.setViewportSize({ width: 812, height: 375 });
    await expectCompactFacts(page);
  }
});

test("missing capacity stays unknown and long node facts remain readable", async ({ page }) => {
  const hostname = "edge-".repeat(20);
  await page.route("**/api/v1/dashboard/latest*", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    delete data.nodes[0].metrics.cpu_count;
    data.nodes[0].metrics.memory_total_bytes = null;
    data.nodes[0].metrics.disk_total_bytes = 0;
    data.nodes[0].system.hostname = hostname;
    await route.fulfill({ response, json: data });
  });
  await openFirstNode(page);
  for (const label of ["CPU", "内存", "磁盘（/）"]) await expect(factValue(page, label)).toHaveText("—");
  await expect(factValue(page, "主机名")).toHaveText(hostname);
  const overflow = await factValue(page, "主机名").evaluate((element) => element.scrollWidth > element.clientWidth + 1);
  expect(overflow).toBe(false);
});
