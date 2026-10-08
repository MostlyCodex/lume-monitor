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
    const cells = [...element.querySelectorAll(".detail-fact")].map((cell) => cell.getBoundingClientRect());
    return {
      firstRowCells: cells.filter((cell) => Math.abs(cell.top - cells[0].top) < 1).length,
      height: element.getBoundingClientRect().height,
      overflowingValues: [...element.querySelectorAll("dd")].filter((value) => value.scrollWidth > value.clientWidth + 1).length,
      pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    };
  });
  // 手机竖屏是单列；更宽的视口至少两列
  expect(geometry.firstRowCells).toBeGreaterThanOrEqual(page.viewportSize().width < 640 ? 1 : 2);
  expect(geometry.height).toBeLessThan(page.viewportSize().width < 640 ? 760 : 440);
  expect(geometry.overflowingValues).toBe(0);
  expect(geometry.pageOverflow).toBe(false);
}

test("node facts show hardware capacity in a compact grid in both themes", async ({ page }, testInfo) => {
  await openFirstNode(page);
  await expect(factValue(page, "CPU 规格")).toHaveText("1 vCPU");
  await expect(factValue(page, "总内存")).toHaveText("1.00 GiB");
  await expect(factValue(page, "总磁盘")).toHaveText("20.00 GiB");
  await expect(page.locator("#detail-facts dt")).toHaveText([
    "操作系统", "系统内核", "CPU 规格", "总内存", "总磁盘", "主机名称", "统计网卡",
  ]);
  for (const theme of ["dark", "light"]) {
    if (theme === "light") await page.locator("#theme-button").click();
    await expectCompactFacts(page);
    await testInfo.attach(`node-facts-${theme}`, {
      body: await page.locator("#detail-facts").screenshot({ animations: "disabled" }),
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
  for (const label of ["CPU 规格", "总内存", "总磁盘"]) await expect(factValue(page, label)).toHaveText("—");
  await expect(factValue(page, "主机名称")).toHaveText(hostname);
  const overflow = await factValue(page, "主机名称").evaluate((element) => element.scrollWidth > element.clientWidth + 1);
  expect(overflow).toBe(false);
});


test("events show the latest five and replace the oldest entry after refresh", async ({ page }) => {
  let latest = 10;
  await page.route("**/api/v1/dashboard/history?*", async (route) => {
    const response = await route.fetch(), data = await response.json();
    const node = new URL(route.request().url()).searchParams.get("node") || "transit-la";
    data.annotations = Array.from({ length: latest }, (_, index) => ({
      node_id: node, timestamp: data.server_time - (latest - index) * 60,
      severity: "INFO", title: `Event ${index + 1}`, detail: "Synthetic event",
    }));
    await route.fulfill({ response, json: data });
  });
  await openFirstNode(page);
  const titles = page.locator("#detail-events .timeline-item strong");
  const expected = (newest) => Array.from({ length: 5 }, (_, index) => `Event ${newest - index}`);
  await expect(titles).toHaveText(expected(10));
  latest = 11;
  await page.locator("#refresh-button").click();
  await expect(titles).toHaveText(expected(11));
});
