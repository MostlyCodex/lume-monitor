import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFrontend } from "./build-frontend.mjs";
import { demoHtml } from "./demo-html.mjs";
export { demoHtml } from "./demo-html.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function buildDemo() {
  await buildFrontend();
  const dashboard = join(root, "worker/public/dashboard");
  const html = await readFile(join(dashboard, "index.html"), "utf8");
  const output = join(root, "demo-dist");
  if (dirname(output) !== root) throw new Error("Demo output must stay inside the project");
  // This directory is generated in full; remove old hashed bundles before publishing.
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  // Publish only the compiled public app; no configuration or management state is copied.
  await cp(dashboard, join(output, "dashboard"), { recursive: true });
  await writeFile(join(output, "index.html"), demoHtml(html, "./dashboard/"));
  await writeFile(join(output, ".nojekyll"), "");
  return output;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(`Demo built: ${await buildDemo()}`);
