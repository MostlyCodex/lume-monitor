import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export function demoHtml(source, assetPrefix = "../dashboard/") {
  return source
    .replace('data-theme="dark"', 'data-theme="dark" data-demo="true"')
    .replace("Private, lightweight VPS observability dashboard.", "体验 Lume：浏览虚构 VPS 的资源、线路质量与历史图表。")
    .replaceAll('"/dashboard/', `"${assetPrefix}`)
    .replace("SECURE OBSERVABILITY", "公开演示 · 虚构数据")
    .replace('<button id="logout-button" class="text-button" type="button">退出</button>', '<a class="text-button" href="https://github.com/MostlyCodex/lume-monitor">GitHub</a><button id="logout-button" type="button" hidden>退出</button>')
    .replace('<main class="page-shell">', '<main class="page-shell"><aside class="demo-notice" aria-label="演示说明"><span>虚构数据，可点击节点体验历史图表和面板设置。</span><a href="https://github.com/MostlyCodex/lume-monitor/blob/main/docs/guide.md">部署自己的 Lume →</a></aside>');
}

export async function buildDemo() {
  const publicDir = join(root, "worker", "public");
  const html = await readFile(join(publicDir, "dashboard", "index.html"), "utf8");
  await mkdir(join(publicDir, "demo"), { recursive: true });
  await writeFile(join(publicDir, "demo", "index.html"), demoHtml(html));
  const output = join(root, "demo-dist");
  await mkdir(output, { recursive: true });
  // Only public, explicitly named inputs are included in the published bundle.
  await cp(join(publicDir, "dashboard"), join(output, "dashboard"), { recursive: true });
  await cp(join(publicDir, "demo", "data.js"), join(output, "data.js"));
  await writeFile(join(output, "index.html"), demoHtml(html, "./dashboard/"));
  await writeFile(join(output, ".nojekyll"), "");
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Demo built: ${await buildDemo()}`);
}
