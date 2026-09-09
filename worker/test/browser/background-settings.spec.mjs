import { expect, test } from "@playwright/test";
import { startPreviewServer } from "../dashboard-preview-server.mjs";

const LAYOUT_KEY = "vpsmon-dashboard-layout-v1";
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

async function openDashboard(page, path = "/dashboard/") {
  await page.goto(`${origin}${path}`, { waitUntil: "networkidle" });
  await expect(page.locator(".node-card")).toHaveCount(6);
}

async function picture(page, { width = 3200, height = 1800, mime = "image/png" } = {}) {
  const base64 = await page.evaluate(({ width, height, mime }) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#274b90");
    gradient.addColorStop(0.5, "#ab5567");
    gradient.addColorStop(1, "#dbaf76");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#f5d8aa";
    context.beginPath();
    context.arc(width * 0.55, height * 0.5, height * 0.12, 0, Math.PI * 2);
    context.fill();
    return canvas.toDataURL(mime).split(",")[1];
  }, { width, height, mime });
  return { name: `background.${mime.split("/")[1]}`, mimeType: mime, buffer: Buffer.from(base64, "base64") };
}

async function selectPicture(page, file) {
  await page.locator("#settings-background-file").setInputFiles(file);
  await expect(page.locator("#settings-background-status")).not.toHaveText("正在处理图片…");
  await expect(page.locator("#settings-save")).toBeEnabled();
}

async function storedLayout(page, key = LAYOUT_KEY) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "{}"), key);
}

test("background preview, save and restore work in both themes and retain other display settings", async ({ page }, testInfo) => {
  const violations = [];
  page.on("console", (message) => {
    if (/Content Security Policy/.test(message.text())) violations.push(message.text());
  });
  await openDashboard(page);
  const file = await picture(page);
  const original = await page.locator(".scene-image").getAttribute("src");
  await page.locator("#settings-button").click();
  await page.locator("#settings-brand").fill("My Lume");
  await selectPicture(page, file);
  await expect(page.locator("#settings-background-error")).toBeHidden();
  const selected = await page.locator(".scene-image").getAttribute("src");
  expect(selected.startsWith("data:image/webp;base64,")).toBe(true);
  expect(selected.length).toBeLessThanOrEqual(1_500_000);
  expect((await storedLayout(page)).background).toBeUndefined();
  await expect.poll(() => page.locator(".scene-image").evaluate((image) => image.naturalWidth)).toBe(1920);
  await expect.poll(() => page.locator(".background-preview img").evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0))).toBe(true);
  const previewStyle = await page.locator(".background-preview img").first().evaluate((image) => ({ fit: getComputedStyle(image).objectFit, filter: getComputedStyle(image).filter }));
  expect(previewStyle.fit).toBe("cover");
  expect(previewStyle.filter).toBe(await page.locator(".scene-image").evaluate((image) => getComputedStyle(image).filter));
  await page.locator("#settings-background-title").scrollIntoViewIfNeeded();
  await testInfo.attach("background-settings-dark", { body: await page.screenshot(), contentType: "image/png" });
  await page.locator("#settings-save").click();
  await expect(page.locator("#settings-dialog")).not.toBeVisible();
  expect((await storedLayout(page)).brand).toBe("My Lume");
  expect((await storedLayout(page)).background === selected).toBe(true);
  await page.reload({ waitUntil: "networkidle" });
  expect(await page.locator(".scene-image").getAttribute("src") === selected).toBe(true);

  await page.locator("#theme-button").click();
  await page.locator("#settings-button").click();
  await expect(page.locator("#settings-brand")).toHaveValue("My Lume");
  await page.locator("#settings-background-title").scrollIntoViewIfNeeded();
  await testInfo.attach("background-settings-light", { body: await page.screenshot(), contentType: "image/png" });
  const geometry = await page.locator("#settings-dialog").evaluate((dialog) => ({ width: dialog.getBoundingClientRect().width, viewport: innerWidth, scroll: dialog.querySelector("form").scrollWidth, content: dialog.querySelector("form").clientWidth }));
  expect(geometry.width).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.content + 1);
  for (const id of ["settings-background-choose", "settings-background-reset", "settings-save", "settings-cancel"]) {
    expect(await page.locator(`#${id}`).evaluate((button) => button.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  }
  if (testInfo.project.name === "mobile-390") {
    const viewport = page.viewportSize();
    for (const size of [{ width: 375, height: 812 }, { width: 812, height: 375 }]) {
      await page.setViewportSize(size);
      await page.locator("#settings-background-title").scrollIntoViewIfNeeded();
      expect(await page.locator("#settings-form").evaluate((form) => form.scrollWidth <= form.clientWidth + 1)).toBe(true);
      await expect(page.locator("#settings-save")).toBeInViewport();
      await testInfo.attach(`background-settings-${size.width}`, { body: await page.screenshot(), contentType: "image/png" });
    }
    await page.setViewportSize({ width: 375, height: 812 });
    await page.locator("#settings-dialog").evaluate((dialog) => {
      dialog.querySelectorAll("button, p, h2, input, label > span, .settings-section-title > *, figcaption").forEach((element) => {
        element.style.fontSize = `${parseFloat(getComputedStyle(element).fontSize) * 2}px`;
      });
    });
    expect(await page.locator("#settings-form").evaluate((form) => form.scrollWidth <= form.clientWidth + 1)).toBe(true);
    await expect(page.locator("#settings-save")).toBeInViewport();
    await page.keyboard.press("Escape");
    await page.setViewportSize(viewport);
    await page.reload({ waitUntil: "networkidle" });
    await page.locator("#settings-button").click();
  }
  await page.locator("#settings-background-reset").click();
  await expect(page.locator(".scene-image")).toHaveAttribute("src", original);
  await page.keyboard.press("Escape");
  await expect(page.locator("#settings-dialog")).not.toBeVisible();
  expect(await page.locator(".scene-image").getAttribute("src") === selected).toBe(true);
  await page.locator("#settings-button").click();
  await page.locator("#settings-background-reset").click();
  await page.locator("#settings-save").click();
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator(".scene-image")).toHaveAttribute("src", original);
  expect((await storedLayout(page)).brand).toBe("My Lume");
  expect((await storedLayout(page)).background).toBe("");
  expect(violations).toEqual([]);
});

test("cancel and close discard selected pictures; demo preferences stay separate", async ({ page }) => {
  await openDashboard(page, "/demo/");
  const file = await picture(page, { mime: "image/jpeg" });
  const original = await page.locator(".scene-image").getAttribute("src");
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  for (const close of ["#settings-cancel", "#settings-close"]) {
    await page.locator("#settings-button").click();
    await selectPicture(page, file);
    await expect(page.locator("#settings-background-error")).toBeHidden();
    await page.locator(close).click();
    await expect(page.locator(".scene-image")).toHaveAttribute("src", original);
    expect((await storedLayout(page, "lume-demo-layout-v1")).background).toBeUndefined();
  }
  await page.locator("#settings-button").click();
  await selectPicture(page, file);
  await page.locator("#settings-save").click();
  expect((await storedLayout(page, "lume-demo-layout-v1")).background.startsWith("data:image/")).toBe(true);
  expect(requests.filter((url) => !url.startsWith("data:") && !url.includes("background-lume.webp"))).toEqual([]);
  await openDashboard(page);
  expect((await storedLayout(page)).background).toBeUndefined();
  await expect(page.locator(".scene-image")).toHaveAttribute("src", /background-lume\.webp/);
});

test("invalid images and storage failure preserve saved settings and allow retry", async ({ page }) => {
  await openDashboard(page);
  await page.locator("#settings-button").click();
  await page.locator("#settings-brand").fill("Saved name");
  await page.locator("#settings-save").click();
  await page.locator("#settings-button").click();
  for (const [file, error] of [
    [{ name: "fake.png", mimeType: "image/png", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') }, "不支持此格式"],
    [{ name: "broken.png", mimeType: "image/png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) }, "图片无法解码"],
    [{ name: "large.png", mimeType: "image/png", buffer: Buffer.alloc(10 * 1024 * 1024 + 1) }, "超过 10 MB"],
    [await picture(page, { width: 6001, height: 4000, mime: "image/jpeg" }), "超过 2400 万像素"],
  ]) {
    await selectPicture(page, file);
    await expect(page.locator("#settings-background-error")).toContainText(error);
    await expect(page.locator(".scene-image")).toHaveAttribute("src", /background-lume\.webp/);
  }
  await selectPicture(page, await picture(page, { mime: "image/webp" }));
  await expect(page.locator("#settings-background-error")).toBeHidden();
  await page.locator("#settings-brand").fill("Unsaved name");
  await page.evaluate((key) => {
    const write = Storage.prototype.setItem;
    window.restoreStorage = () => { Storage.prototype.setItem = write; };
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException("Storage full", "QuotaExceededError");
      return write.call(this, name, value);
    };
  }, LAYOUT_KEY);
  await page.locator("#settings-save").click();
  await expect(page.locator("#settings-error")).toContainText("未能保存");
  await expect(page.locator("#settings-dialog")).toBeVisible();
  expect((await storedLayout(page)).brand).toBe("Saved name");
  expect((await storedLayout(page)).background).toBe("");
  await page.evaluate(() => window.restoreStorage());
  await page.locator("#settings-save").click();
  await page.reload({ waitUntil: "networkidle" });
  expect((await storedLayout(page)).brand).toBe("Unsaved name");
  expect((await storedLayout(page)).background.startsWith("data:image/")).toBe(true);
  await page.locator("#settings-button").click();
  await page.locator("#settings-reset").click();
  expect(await storedLayout(page)).toEqual({});
  await expect(page.locator(".scene-image")).toHaveAttribute("src", /background-lume\.webp/);
});

test("late image processing cannot overwrite a cancelled or newer selection", async ({ page }) => {
  await openDashboard(page);
  const file = await picture(page);
  await page.evaluate(() => {
    const decode = HTMLImageElement.prototype.decode;
    window.pendingDecodes = [];
    HTMLImageElement.prototype.decode = function () {
      return new Promise((resolve, reject) => window.pendingDecodes.push(() => decode.call(this).then(resolve, reject)));
    };
  });
  await page.locator("#settings-button").click();
  await page.locator("#settings-background-file").setInputFiles(file);
  await expect(page.locator("#settings-save")).toBeDisabled();
  await expect.poll(() => page.evaluate(() => window.pendingDecodes.length)).toBe(1);
  await page.locator("#settings-cancel").click();
  await page.locator("#settings-button").click();
  await page.locator("#settings-background-file").setInputFiles(await picture(page, { width: 800, height: 600 }));
  await expect.poll(() => page.evaluate(() => window.pendingDecodes.length)).toBe(2);
  await page.evaluate(() => window.pendingDecodes[1]());
  await expect(page.locator("#settings-save")).toBeEnabled();
  const selected = await page.locator(".scene-image").getAttribute("src");
  await page.evaluate(() => window.pendingDecodes[0]());
  expect(await page.locator(".scene-image").getAttribute("src") === selected).toBe(true);
  await page.locator("#settings-save").click();
  expect((await storedLayout(page)).background === selected).toBe(true);
});

test("invalid stored backgrounds fall back without loading external images or losing the panel name", async ({ page }) => {
  await openDashboard(page);
  const externalRequests = [];
  await page.route("https://example.invalid/**", (route) => {
    externalRequests.push(route.request().url());
    return route.abort();
  });
  for (const background of ["https://example.invalid/background.png", "data:image/svg+xml;base64,PHN2Zy8+", "data:image/png;base64,aGVsbG8="]) {
    await page.evaluate(({ key, background }) => localStorage.setItem(key, JSON.stringify({ brand: "Keep this name", background })), { key: LAYOUT_KEY, background });
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator(".scene-image")).toHaveAttribute("src", /background-lume\.webp/);
    await expect.poll(() => page.locator(".scene-image").evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
    await page.locator("#settings-button").click();
    await expect(page.locator("#settings-brand")).toHaveValue("Keep this name");
    await expect(page.locator("#settings-background-status")).toHaveText("当前为默认背景");
    await page.locator("#settings-cancel").click();
  }
  expect(externalRequests).toEqual([]);
});
