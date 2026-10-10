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
const open = async (page) => {
  await page.goto(`${origin}/dashboard/`, { waitUntil: "networkidle" });
  await expect(page.locator(".node-card")).toHaveCount(6);
};

test("late history cannot replace the selected node, and browser back restores navigation", async ({
  page,
}) => {
  let release,
    delayed = false;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/dashboard/history?*", async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch(),
      data = await response.json();
    const node = url.searchParams.get("node");
    data.annotations = node
      ? [
          {
            node_id: node,
            timestamp: data.server_time,
            severity: "INFO",
            title: `History ${node}`,
            detail: "Synthetic history",
          },
        ]
      : [];
    if (node === "transit-la" && !delayed) {
      delayed = true;
      await gate;
    }
    await route.fulfill({ response, json: data });
  });
  try {
    await open(page);
    await page.locator('[data-node="transit-la"]').click();
    await expect.poll(() => delayed).toBe(true);
    await page.locator("#detail-back").click();
    await page.locator('[data-node="transit-eb"]').click();
    await expect(page.locator("#detail-events")).toContainText("History transit-eb");
    const oldResponse = page.waitForResponse((response) =>
      response.url().includes("node=transit-la"),
    );
    release();
    await oldResponse;
    await expect(page.locator("#detail-hero h1")).toHaveText("Transit-Edge-Bridge");
    await expect(page.locator("#detail-events")).not.toContainText("History transit-la");
    await page.goBack();
    await expect(page.locator("#fleet-view")).toBeVisible();
    await page.goBack();
    await expect(page.locator("#detail-hero h1")).toHaveText("Transit-Los-Angeles");
  } finally {
    release();
  }
});

test("charts load on demand and release their observers when details close", async ({ page }) => {
  const chunks = [];
  page.on("request", (request) => {
    if (/HistoryChart-.*\.js/.test(request.url())) chunks.push(request.url());
  });
  await page.addInitScript(() => {
    const Native = window.ResizeObserver;
    const observers = new Set();
    window.ResizeObserver = class extends Native {
      targets = new Set();
      constructor(callback) {
        super(callback);
        observers.add(this);
      }
      observe(target, options) {
        this.targets.add(target);
        super.observe(target, options);
      }
      unobserve(target) {
        this.targets.delete(target);
        super.unobserve(target);
      }
      disconnect() {
        this.targets.clear();
        super.disconnect();
      }
    };
    window.chartObservers = () =>
      [...observers]
        .flatMap((observer) => [...observer.targets])
        .filter((target) => target.classList?.contains("history-chart")).length;
  });
  await open(page);
  expect(chunks).toHaveLength(0);
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.locator(".node-card").first().click();
    await expect(page.locator("#node-detail .history-chart")).toHaveCount(3);
    await expect.poll(() => page.evaluate(() => window.chartObservers())).toBe(3);
    await page.locator("#detail-back").click();
    await expect.poll(() => page.evaluate(() => window.chartObservers())).toBe(0);
  }
  expect(chunks).toHaveLength(1);
});

test("history errors can retry without losing the node or interpreting labels as HTML", async ({
  page,
}) => {
  let fail = true;
  const label = '<img src=x onerror="window.injected=true">';
  await page.route("**/api/v1/dashboard/latest", async (route) => {
    const response = await route.fetch(),
      data = await response.json();
    data.nodes[0].label = label;
    await route.fulfill({ response, json: data });
  });
  await page.route("**/api/v1/dashboard/history?*", async (route) => {
    const url = new URL(route.request().url());
    if (fail && url.searchParams.get("node") && url.searchParams.get("hours") === "168")
      return route.fulfill({ status: 503, json: { error: "temporarily unavailable" } });
    return route.continue();
  });
  await open(page);
  await expect(page.locator(".node-title").first()).toContainText(label);
  await expect(page.locator(".node-title img")).toHaveCount(0);
  await page.locator(".node-card").first().click();
  await page.locator('[data-hours="168"]').click();
  await expect(page.locator("#detail-loading")).toContainText("读取失败");
  await expect(page.locator("#detail-hero h1")).toHaveText(label);
  fail = false;
  await page.locator("#refresh-button").click();
  await expect(page.locator("#detail-loading")).toBeHidden();
  await expect(page.locator("#latency-plot svg")).toBeVisible();
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
});

test("dragging a node card reorders the fleet and persists the order", async ({ page }) => {
  await open(page);
  const cards = page.locator("#node-grid [data-node]");
  const ids = () => cards.evaluateAll((nodes) => nodes.map((node) => node.dataset.node));
  const before = await ids();
  const from = await cards.nth(0).boundingBox(),
    to = await cards.nth(1).boundingBox();
  await page.mouse.move(from.x + 40, from.y + 30);
  await page.mouse.down();
  // 拖到目标卡片中部，保持接近真实手速
  for (let step = 1; step <= 20; step++) {
    await page.mouse.move(
      from.x + 40 + ((to.x + to.width * 0.6 - from.x - 40) * step) / 20,
      from.y + 30 + ((to.y + to.height / 2 - from.y - 30) * step) / 20,
    );
    await page.waitForTimeout(16);
  }
  // 拖动中：浮起的副本挂在 body 上紧跟指针（无过渡），原位置留下占位
  await expect
    .poll(() =>
      page.evaluate(() => {
        const clone = document.querySelector(".node-card-drag");
        return {
          parent: clone?.parentElement?.tagName,
          transition: clone && getComputedStyle(clone).transitionDuration,
          placeholders: document.querySelectorAll("#node-grid .node-card-ghost").length,
        };
      }),
    )
    .toEqual({ parent: "BODY", transition: "0s", placeholders: 1 });
  await page.mouse.up();
  const expected = [before[1], before[0], ...before.slice(2)];
  await expect.poll(ids).toEqual(expected);
  await expect(page.locator("#node-detail")).toHaveCount(0);
  await page.reload({ waitUntil: "networkidle" });
  await expect.poll(ids).toEqual(expected);
});

test("long-range chart labels show real dates and fit without overlapping in either theme", async ({
  page,
}) => {
  await open(page);
  await page.locator(".node-card").first().click();
  const fixedNow = Number(process.env.PREVIEW_NOW) * 1000;
  const monthOf = (time) =>
    new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit" })
      .format(new Date(time))
      .replace(/[^0-9]/g, "");
  for (const hours of [168, 720]) {
    const response = page.waitForResponse(
      (response) => response.url().includes(`hours=${hours}`) && response.url().includes("node="),
    );
    await page.locator(`[data-hours="${hours}"]`).click();
    await response;
    await expect(page.locator("#node-detail .history-chart svg")).toHaveCount(3);
    const plots = await page.locator("#node-detail .history-chart svg").evaluateAll((svgs) =>
      svgs.map((svg) => {
        const frame = svg.getBoundingClientRect();
        return {
          left: frame.left,
          right: frame.right,
          labels: [...svg.querySelectorAll(".x-axis text")]
            .map((text) => {
              const box = text.getBoundingClientRect();
              return { text: text.textContent.trim(), left: box.left, right: box.right };
            })
            .sort((a, b) => a.left - b.left),
        };
      }),
    );
    // 坐标轴日期必须落在请求的时间范围内（曾出现时间戳被多除 1000、显示成 1970 年的回归）
    const months = new Set();
    for (let time = fixedNow - (hours + 24) * 3600_000; time <= fixedNow + 86400_000; time += 86400_000)
      months.add(monthOf(time));
    for (const plot of plots) {
      expect(plot.labels).toHaveLength(3);
      for (const [index, label] of plot.labels.entries()) {
        expect(months).toContain(label.text.slice(0, 2));
        expect(label.left).toBeGreaterThanOrEqual(plot.left - 1);
        expect(label.right).toBeLessThanOrEqual(plot.right + 1);
        if (index) expect(label.left - plot.labels[index - 1].right).toBeGreaterThanOrEqual(8);
      }
    }
    await page.locator("#theme-button").click();
  }
});
