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

test("public demo works without authentication or telemetry requests", async ({ page }) => {
  const sensitiveRequests = [];
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(/\/(api|auth)\//, async (route) => {
    sensitiveRequests.push(route.request().url());
    await route.abort();
  });
  await page.goto(`${previewOrigin}/demo/`, { waitUntil: "networkidle" });
  await expect(page.locator(".node-card")).toHaveCount(6);
  await expect(page.locator("#demo-notice")).toContainText("虚构数据");
  await page.locator('.node-card[data-node="transit-la"]').click();
  await expect(page.locator("#node-detail")).toBeVisible();
  // 服务只显示名称与状态色圆点，状态文字保留在 aria-label / title 中
  await expect(page.locator(".detail-service")).toHaveText(["nftables"]);
  await expect(page.locator(".detail-service")).toHaveAttribute("aria-label", /运行正常/);
  await expect(page.locator("#latency-plot svg")).toBeVisible();
  await page.locator('#detail-range-switch button[data-hours="168"]').click();
  await expect(page.locator("#latency-plot svg")).toBeVisible();
  await page.locator("#detail-back").click();
  expect(new URL(page.url()).pathname).toBe("/demo/");
  await page.locator("#theme-button").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expectNoHorizontalOverflow(page);
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator(".node-card")).toHaveCount(6);
  expect(sensitiveRequests).toEqual([]);
  expect(errors).toEqual([]);
});

async function openDashboard(page) {
  await page.clock.install({ time: FIXED_TIME });
  await page.goto(`${previewOrigin}/dashboard/`, { waitUntil: "networkidle" });
  await expect(page.locator("#loading-view")).toBeHidden();
  await expect(page.locator("#dashboard-view")).toBeVisible();
  await expect(page.locator(".node-card")).toHaveCount(6);
}

for (const online of [true, false]) {
  test(`missing service reports stay neutral when the node is ${online ? "online" : "offline"}`, async ({ page }) => {
    await page.route("**/api/v1/dashboard/latest*", async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      Object.assign(data.nodes[0], { services: [], probes: [], online });
      await route.fulfill({ response, json: data });
    });
    await openDashboard(page);
    await page.locator(".node-card").first().click();
    // 节点只有“在线 + 运行时长”和置灰的“下线”两种状态
    await expect(page.locator("#detail-hero .node-status")).toHaveText(online ? /^\s*在线\s+\d/ : "下线");
    await expect(page.locator(".detail-service")).toHaveCount(1);
    await expect(page.locator(".detail-service")).toHaveClass(/\bis-neutral\b/);
    await expect(page.locator(".detail-service")).toHaveText("服务监测：暂无上报");
    await expect(page.locator("#detail-hero")).not.toContainText("基础监测正常");
  });
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

// 卡片是一个整体：没有内嵌面板、国旗、页脚；四个区块以分割线隔开；
// 每个探测点两条 24 格（每格 1 小时）的格栅（延迟、丢包率），两列等分卡片宽度；格高固定，格宽随列宽等分。
async function expectCompactNodeCards(page) {
  const firstCard = page.locator(".node-card").first();
  await expect(firstCard.locator(".node-network-row")).toHaveCount(2);
  // 全部探测都上首页：三网 + 两条节点互联
  await expect(firstCard.locator(".probe-row")).toHaveCount(5);
  // 节点互联只显示目标节点名称；名称在延迟格栅左上角，卡片顶部有“延迟 / 丢包”列标题
  await expect(firstCard.locator(".probe-row").last().locator(".probe-name")).toHaveText("Egress-Las-Vegas");
  await expect(firstCard.locator(".probe-columns")).toHaveText(/延迟\s*丢包/);
  await expect(firstCard.locator(".node-status")).toHaveText(/^\s*在线\s+\d/);
  await expect(firstCard.locator(".probe-row").last().locator('[data-metric="loss"]')).toHaveCount(1);
  await expect(firstCard.locator('.probe-row [data-metric="latency"] .energy-cell')).toHaveCount(5 * 24);
  await expect(firstCard.locator('.probe-row [data-metric="loss"] .energy-cell')).toHaveCount(5 * 24);
  // 两列格栅等宽，且合起来铺满网络质量区，不留大块空白
  const grids = await firstCard.locator(".probe-row").first().evaluate((row) => {
    const [latency, loss] = [...row.querySelectorAll("[data-metric]")].map((grid) => grid.getBoundingClientRect());
    const area = row.getBoundingClientRect();
    return { latencyWidth: latency.width, lossWidth: loss.width, start: latency.left - area.left, end: area.right - loss.right };
  });
  expect(Math.abs(grids.latencyWidth - grids.lossWidth)).toBeLessThanOrEqual(1);
  expect(grids.start).toBeLessThanOrEqual(1);
  expect(grids.end).toBeLessThanOrEqual(1);
  // 所有行的延迟格栅左对齐
  const latencyLeft = await firstCard
    .locator('.probe-row [data-metric="latency"]')
    .evaluateAll((grids) => [...new Set(grids.map((grid) => Math.round(grid.getBoundingClientRect().left)))]);
  expect(latencyLeft).toHaveLength(1);
  const layout = await page.locator(".node-card").evaluateAll((cards) =>
    cards.map((card) => {
      const cardRect = card.getBoundingClientRect();
      const values = [...card.querySelectorAll(".node-network-row span")];
      const cells = [...card.querySelectorAll(".energy-cell")].map((cell) => cell.getBoundingClientRect());
      return {
        height: cardRect.height,
        titleSize: parseFloat(getComputedStyle(card.querySelector(".node-title")).fontSize),
        clippedValues: values
          .filter((value) => value.scrollWidth > value.clientWidth + 1)
          .map((value) => value.textContent),
        nestedPanels: [...card.querySelectorAll("*")].filter((element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return (
            parseFloat(style.borderTopWidth) > 0 &&
            parseFloat(style.borderBottomWidth) > 0 &&
            rect.width > 80 &&
            rect.height > 32
          );
        }).length,
        graphics: card.querySelectorAll("svg, img").length,
        footerText: /前更新|线路中转机/.test(card.textContent),
        cellHeights: [...new Set(cells.map((cell) => cell.height))],
        cellWidths: cells.map((cell) => cell.width),
        dividers: [...card.querySelectorAll("section")].filter(
          (section) => parseFloat(getComputedStyle(section).borderTopWidth) > 0,
        ).length,
        probeText: card.querySelector(".probe-row")?.parentElement?.parentElement?.textContent ?? "",
      };
    }),
  );
  expect(layout[0].dividers).toBe(3);
  const maxHeight = page.viewportSize().width <= 760 ? 460 : 480;
  for (const card of layout) {
    expect(card.height).toBeLessThan(maxHeight);
    expect(card.titleSize).toBeGreaterThanOrEqual(16);
    expect(card.clippedValues).toEqual([]);
    expect(card.nestedPanels).toBe(0);
    expect(card.graphics).toBe(0);
    expect(card.footerText).toBe(false);
    if (card.cellWidths.length) {
      expect(card.cellHeights).toEqual([14]);
      expect(Math.min(...card.cellWidths)).toBeGreaterThanOrEqual(2);
      expect(Math.max(...card.cellWidths) - Math.min(...card.cellWidths)).toBeLessThanOrEqual(1);
    }
    expect(card.probeText).not.toMatch(/目标|24H/);
  }
}

async function expectSmallPhoneAndLandscapeLayout(page) {
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 812, height: 375 },
  ]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(280);
    await expectNoHorizontalOverflow(page);
    await expectCompactNodeCards(page);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(280);
}

async function focusByKeyboard(page, selector) {
  for (let step = 0; step < 40; step += 1) {
    await page.keyboard.press("Tab");
    if (await page.evaluate((selector) => document.activeElement?.matches(selector), selector)) return;
  }
  throw new Error(`Keyboard focus never reached ${selector}`);
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
  await expectCompactNodeCards(page);
  await expect(page.locator("#settings-button")).toHaveCount(0);
  await expect(page.locator("#summary-strip")).toHaveCount(0);
  await expect(page.locator("#fleet-view")).not.toContainText(/拖动可调整顺序|节点$/);
  const header = await page.locator("header").first().evaluate((element) => {
    const style = getComputedStyle(element);
    return { backdrop: style.backdropFilter, background: style.backgroundColor };
  });
  expect(header.backdrop).toBe("none");
  expect(header.background).not.toMatch(/rgba(.*,s*0?.d+)$/);
  // 搜索框位于右侧且不再占满整行（手机竖屏除外）
  const search = await page.locator("#node-search").boundingBox();
  const grid = await page.locator("#node-grid").boundingBox();
  expect(Math.abs(search.x + search.width - (grid.x + grid.width))).toBeLessThanOrEqual(1);
  if (page.viewportSize().width >= 640) expect(search.width).toBeLessThanOrEqual(260);

  await focusByKeyboard(page, ".node-card");
  const focusRing = await page.evaluate(() => getComputedStyle(document.activeElement).boxShadow);
  expect(focusRing).not.toBe("none");

  if (testInfo.project.name === "mobile-390") await expectSmallPhoneAndLandscapeLayout(page);

  await attachScreenshot(page, testInfo, `${testInfo.project.name}-fleet-dark`);

  await page.locator("#theme-button").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expectNoHorizontalOverflow(page);
  await expectCompactNodeCards(page);
  await attachScreenshot(page, testInfo, `${testInfo.project.name}-fleet-light`);
});

test("node detail renders charts, color keys and mobile controls", async ({ page }, testInfo) => {
  await openDashboard(page);
  await page.locator(".node-card").first().click();
  await expect(page.locator("#node-detail")).toBeVisible();
  await expect(page.locator("#latency-plot svg")).toBeVisible();
  await expect(page.locator("#loss-plot svg")).toBeVisible();
  await expect(page.locator("#traffic-plot svg")).toBeVisible();
  await expect(page.locator(".detail-probe-card")).toHaveCount(5);
  // 延迟图和丢包率图都画全部 5 条线路（TCP 的丢包是超时未完成的握手）
  await expect(page.locator("#latency-plot .line-layer path[stroke]")).toHaveCount(5);
  await expect(page.locator("#loss-plot .line-layer path[stroke]")).toHaveCount(5);
  await expect(page.locator("#node-detail")).not.toContainText(/建连失败|可达性/);
  await expect(page.locator("#counter-section")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  // 每个探针卡片的色块与图表曲线颜色一致；同类链路共用一种颜色
  const swatches = await page
    .locator(".detail-probe-swatch")
    .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).backgroundColor));
  expect(swatches).toHaveLength(5);
  expect(new Set(swatches).size).toBe(4);
  const lineColors = await page
    .locator("#latency-plot .line-layer path[stroke]")
    .evaluateAll((paths) => paths.map((path) => getComputedStyle(path).stroke));
  expect(new Set(lineColors)).toEqual(new Set(swatches));

  await focusByKeyboard(page, ".detail-probe-card");
  const focusRing = await page.evaluate(() => getComputedStyle(document.activeElement).boxShadow);
  expect(focusRing).not.toBe("none");

  // 详情顶部卡片不显示国旗，保持紧凑
  await expect(page.locator("#detail-hero svg, #detail-hero img")).toHaveCount(0);
  const narrow = page.viewportSize().width < 640;
  if (narrow) {
    const hero = await page.locator("#detail-hero").boundingBox();
    expect(hero.height).toBeLessThan(200);
    // 手机上探测点两列排列，5 个探测点不超过 3 行
    const probeRows = await page
      .locator(".detail-probe-card")
      .evaluateAll((cards) => new Set(cards.map((card) => Math.round(card.getBoundingClientRect().top))).size);
    expect(probeRows).toBeLessThanOrEqual(3);
  }

  // 图表按容器宽度绘制，手机上不会整体缩小；纵轴刻度为整数加单位，单位完整显示不换行
  const plot = await page.locator("#latency-plot svg").boundingBox();
  expect(plot.height).toBeGreaterThanOrEqual(220);
  for (const id of ["#latency-plot", "#loss-plot", "#traffic-plot"]) {
    const axis = await page.locator(`${id} svg`).evaluate((svg) => {
      const frame = svg.getBoundingClientRect();
      const labels = [...svg.querySelectorAll("text")].filter((text) => !text.closest(".x-axis"));
      return {
        clipped: labels.some((text) => text.getBoundingClientRect().left < frame.left - 0.5),
        axisWidth: Math.max(...labels.map((text) => text.getBoundingClientRect().right)) - frame.left,
        integerWithUnit: labels.every((text) =>
          /^\d+(ms|%|[KMGT]?B\/s)$/.test(text.textContent.trim()),
        ),
      };
    });
    expect(axis.clipped).toBe(false);
    expect(axis.integerWithUnit).toBe(true);
    if (narrow) expect(axis.axisWidth).toBeLessThanOrEqual(64);
  }

  if (testInfo.project.use.hasTouch) {
    // 点按图表出现提示，点按图表外部即可收起
    await page.locator("#latency-plot").scrollIntoViewIfNeeded();
    const host = await page.locator("#latency-plot").boundingBox();
    await page.touchscreen.tap(host.x + host.width / 2, host.y + 80);
    await expect(page.locator("#latency-plot .plot-tooltip")).toBeVisible();
    await page.touchscreen.tap(5, 5);
    await expect(page.locator("#latency-plot .plot-tooltip")).toHaveCount(0);
  }

  await attachScreenshot(page, testInfo, `${testInfo.project.name}-detail-dark`);
});

test("probe chips show their state immediately and drive both latency and loss charts", async ({ page }, testInfo) => {
  await openDashboard(page);
  await page.locator(".node-card").first().click();
  // 点击后指针仍停在按钮上（触屏上悬停状态会一直保留），状态也必须立即正确显示
  const press = (locator) => (testInfo.project.use.hasTouch ? locator.tap() : locator.click());

  const chip = page.locator(".detail-probe-card").first();
  await press(chip);
  await expect(chip).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => chip.evaluate((element) => Number(getComputedStyle(element).opacity))).toBeLessThan(0.7);
  await expect(page.locator("#latency-plot .line-layer path[stroke]")).toHaveCount(4);
  await expect(page.locator("#loss-plot .line-layer path[stroke]")).toHaveCount(4);
  // 探测点按钮没有外框
  expect(
    await page.locator(".detail-probe-card").evaluateAll((elements) =>
      elements.filter((element) => parseFloat(getComputedStyle(element).borderTopWidth) > 0).length,
    ),
  ).toBe(0);

  await press(page.locator('[data-probe-action="none"]'));
  await expect(page.locator("#latency-empty")).toHaveText("未选择要显示的线路");
  await expect(page.locator("#loss-empty")).toHaveText("未选择要显示的线路");
  await press(page.locator('[data-probe-action="all"]'));
  await expect(page.locator("#latency-plot svg")).toBeVisible();
  await expect(page.locator("#loss-plot svg")).toBeVisible();
});

test("a node with a single probe still shows both grids and the loss chart", async ({ page }) => {
  await page.route("**/api/v1/dashboard/latest*", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.nodes[0].probes = data.nodes[0].probes.slice(-1);
    await route.fulfill({ response, json: data });
  });
  await openDashboard(page);
  const card = page.locator(".node-card").first();
  await expect(card.locator(".probe-row")).toHaveCount(1);
  await expect(card.locator('.probe-row [data-metric="loss"]')).toHaveCount(1);
  await card.click();
  await expect(page.locator("#latency-plot svg")).toBeVisible();
  await expect(page.locator("#detail-loss")).toHaveCount(1);
});
