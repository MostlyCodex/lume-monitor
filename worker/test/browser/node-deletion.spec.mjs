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

test("permanent deletion prunes browser preferences while retirement preserves them", async ({
  page,
}) => {
  const key = "vpsmon-dashboard-layout-v1";
  let deleted = false;
  await page.route("**/api/v1/dashboard/latest", async (route) => {
    const response = await route.fetch(),
      data = await response.json();
    data.catalog.known_node_ids = data.catalog.nodes
      .map((node) => node.id)
      .concat("retired-node");
    if (deleted) {
      data.catalog.known_node_ids = data.catalog.known_node_ids.filter(
        (id) => id !== "transit-la",
      );
      data.catalog.nodes = data.catalog.nodes.filter(
        (node) => node.id !== "transit-la",
      );
      data.nodes = data.nodes.filter((node) => node.id !== "transit-la");
    }
    await route.fulfill({ response, json: data });
  });
  await page.addInitScript(
    (key) =>
      localStorage.setItem(
        key,
        JSON.stringify({
          brand: "My monitor",
          nodes: {
            "transit-la": { label: "Delete this" },
            "retired-node": { label: "Restore later" },
            "transit-eb": { label: "Keep this" },
          },
          order: ["transit-la", "retired-node", "transit-eb"],
        }),
      ),
    key,
  );
  await page.goto(`${origin}/dashboard/`, { waitUntil: "networkidle" });
  await expect(page.locator(".node-card")).toHaveCount(6);
  await page.locator('[data-node="transit-la"]').click();
  await expect(page.locator("#node-detail")).toBeVisible();
  deleted = true;
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(page.locator(".node-card")).toHaveCount(5);
  await expect
    .poll(() =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key),
    )
    .toEqual({
      brand: "My monitor",
      nodes: {
        "retired-node": {
          label: "Restore later",
          role: "",
          region: "",
          country: "",
        },
        "transit-eb": { label: "Keep this", role: "", region: "", country: "" },
      },
      order: ["retired-node", "transit-eb"],
      background: "",
    });
  await expect(page.locator("#node-detail")).toHaveCount(0);
});
