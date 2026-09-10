import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { demoHtml } from "./demo-html.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function buildFrontend() {
  const worker = join(root, "worker");
  await new Promise((accept, reject) => {
    const child = spawn(
      process.execPath,
      [
        join(worker, "node_modules/vite/bin/vite.js"),
        "build",
        "--config",
        "frontend/vite.config.mjs",
      ],
      { cwd: worker, stdio: "inherit", windowsHide: true },
    );
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? accept() : reject(new Error(`Frontend build failed (${code})`)),
    );
  });
  const html = await readFile(join(worker, "public/dashboard/index.html"), "utf8");
  const demo = join(worker, "public/demo");
  if (dirname(demo) !== join(worker, "public"))
    throw new Error("Demo entry must stay inside public assets");
  await rm(demo, { recursive: true, force: true });
  await mkdir(demo, { recursive: true });
  await writeFile(join(demo, "index.html"), demoHtml(html));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await buildFrontend();
