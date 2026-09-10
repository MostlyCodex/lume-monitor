import { createDemoData } from "../frontend/src/demo/data.js";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.PORT || 4173);
const previewNow = Number(process.env.PREVIEW_NOW || Math.floor(Date.now() / 1000));
const publicRoot = resolve(fileURLToPath(new URL("../public/", import.meta.url)));
const dashboardCsp = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".webp", "image/webp"],
  [".jpg", "image/jpeg"],
  [".txt", "text/plain; charset=utf-8"],
]);

const { latestData, historyData } = createDemoData(previewNow);

function json(response, status = 200) {
  return { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }, body: JSON.stringify(response) };
}

async function handle(request) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === "/api/v1/dashboard/latest") return json(latestData());
  if (url.pathname === "/api/v1/dashboard/history") {
    const hours = [6, 24, 168, 720, 2160].includes(Number(url.searchParams.get("hours"))) ? Number(url.searchParams.get("hours")) : 24;
    return json(historyData(hours, url.searchParams.get("node")));
  }
  if (url.pathname === "/auth/logout") return { status: 204, headers: {}, body: "" };
  const relative = url.pathname === "/" || url.pathname === "/dashboard" || url.pathname === "/dashboard/"
    ? "dashboard/index.html"
    : url.pathname === "/demo/" ? "demo/index.html" : url.pathname.replace(/^\/+/, "");
  const absolute = resolve(publicRoot, relative);
  if (absolute !== publicRoot && !absolute.startsWith(`${publicRoot}${sep}`)) return { status: 403, headers: {}, body: "Forbidden" };
  try {
    return { status: 200, headers: { "content-type": mimeTypes.get(extname(absolute)) || "application/octet-stream", "cache-control": "no-store", "content-security-policy": dashboardCsp }, body: await readFile(absolute) };
  } catch {
    return { status: 404, headers: { "content-type": "text/plain; charset=utf-8" }, body: "Not found" };
  }
}

export function createPreviewServer() {
  return createServer(async (request, response) => {
    const result = await handle(request);
    response.writeHead(result.status, result.headers);
    response.end(result.body);
  });
}

export function startPreviewServer(listenPort = port) {
  const server = createPreviewServer();
  return new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(listenPort, "127.0.0.1", () => resolvePromise(server));
  });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const server = await startPreviewServer();
  process.stdout.write(`Dashboard preview ready at http://127.0.0.1:${port}/dashboard/\n`);
  const closePreviewServer = () => {
    server.closeAllConnections?.();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  };
  process.once("SIGINT", closePreviewServer);
  process.once("SIGTERM", closePreviewServer);
}
