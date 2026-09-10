import { readFileSync, existsSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { demoHtml } from "../../tools/demo-html.mjs";
const root = fileURLToPath(new URL("../public/dashboard/", import.meta.url));
const html = readFileSync(resolve(root, "index.html"), "utf8");
describe("built frontend", () => {
  it("loads compiled same-origin modules and styles from existing public assets", () => {
    const assets = [...html.matchAll(/(?:src|href)="(\.\/assets\/[^"<>]+)"/g)].map(
      (match) => match[1],
    );
    expect(assets.length).toBeGreaterThanOrEqual(2);
    for (const asset of assets) {
      const path = resolve(root, asset);
      expect(path.startsWith(resolve(root) + sep)).toBe(true);
      expect(existsSync(path)).toBe(true);
    }
    expect(html).toMatch(/<script type="module"/);
    expect(html).not.toMatch(/<(?:script|link)[^>]+(?:src|href)="https?:/);
  });
  it("uses the same compiled bundle from a Pages project path", () => {
    const demo = demoHtml(html, "./dashboard/");
    const assets = [...demo.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
    expect(demo).toContain('data-demo="true"');
    for (const asset of assets)
      expect(new URL(asset, "https://example.test/project/").pathname).toMatch(
        /^\/project\/dashboard\/assets\//,
      );
  });
});
