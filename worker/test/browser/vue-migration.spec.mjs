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
        .filter((target) => target.classList.contains("plot-host")).length;
  });
  await open(page);
  expect(chunks).toHaveLength(0);
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.locator(".node-card").first().click();
    await expect(page.locator("#node-detail .uplot")).toHaveCount(2);
    await expect.poll(() => page.evaluate(() => window.chartObservers())).toBe(2);
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
  await expect(page.locator("#network-plot .uplot")).toBeVisible();
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
});

test("reordering node drafts retains unsaved edits and persists only on save", async ({ page }) => {
  await open(page);
  await page.locator("#settings-button").click();
  const row = page.locator('[data-settings-node="transit-eb"]');
  await row.locator('[data-settings-field="label"]').fill("My second node");
  await row.locator('[data-settings-field="country"]').fill("jp");
  await row.locator('[data-settings-move="-1"]').click();
  await expect(page.locator("[data-settings-node]").first()).toHaveAttribute(
    "data-settings-node",
    "transit-eb",
  );
  await expect(row.locator('[data-settings-field="label"]')).toHaveValue("My second node");
  expect(await page.evaluate(() => localStorage.getItem("vpsmon-dashboard-layout-v1"))).toBeNull();
  await page.locator("#settings-save").click();
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator(".node-card").first()).toHaveAttribute("data-node", "transit-eb");
  await expect(page.locator(".node-title strong").first()).toHaveText("My second node");
  await expect(page.locator(".node-flag").first()).toHaveAttribute("aria-label", "JP");
});

test("long-range chart labels fit without overlapping in either theme", async ({ page }) => {
  await page.addInitScript(() => {
    const prototype = CanvasRenderingContext2D.prototype;
    const fillText = prototype.fillText,
      clearRect = prototype.clearRect;
    prototype.clearRect = function (...args) {
      this.canvas.dateLabels = [];
      return clearRect.apply(this, args);
    };
    prototype.fillText = function (text, x, y, ...args) {
      if (/^\d{2}\/\d{2}/.test(String(text))) {
        const metrics = this.measureText(text);
        (this.canvas.dateLabels ??= []).push({
          text,
          x,
          y,
          left: x - metrics.actualBoundingBoxLeft,
          right: x + metrics.actualBoundingBoxRight,
        });
      }
      return fillText.call(this, text, x, y, ...args);
    };
  });
  await open(page);
  await page.locator(".node-card").first().click();
  for (const hours of [168, 720]) {
    const response = page.waitForResponse(
      (response) => response.url().includes(`hours=${hours}`) && response.url().includes("node="),
    );
    await page.locator(`[data-hours="${hours}"]`).click();
    await response;
    await expect(page.locator("#node-detail .uplot")).toHaveCount(2);
    await expect
      .poll(async () =>
        page
          .locator("#node-detail .uplot canvas")
          .evaluateAll((canvases) => canvases.every((canvas) => canvas.dateLabels?.length > 0)),
      )
      .toBe(true);
    const plots = await page.locator("#node-detail .uplot canvas").evaluateAll((canvases) =>
      canvases.map((canvas) => ({
        width: canvas.width,
        labels: [
          ...new Map(
            canvas.dateLabels.map((label) => [`${label.x}:${label.y}:${label.text}`, label]),
          ).values(),
        ].sort((a, b) => a.x - b.x),
      })),
    );
    for (const plot of plots) {
      for (const [index, label] of plot.labels.entries()) {
        expect(label.left).toBeGreaterThanOrEqual(0);
        expect(label.right).toBeLessThanOrEqual(plot.width);
        if (index) expect(label.left - plot.labels[index - 1].right).toBeGreaterThanOrEqual(8);
      }
    }
    await page.locator("#theme-button").click();
  }
});
