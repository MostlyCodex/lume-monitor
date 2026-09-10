import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { build } from "esbuild";
import { unstable_splitSqlQuery as splitSQL } from "wrangler";

// The SQL splitter and atomic D1 batch are the same ones used by Wrangler.
// One runtime owns the test database; switching code keeps its state intact.
export async function localRuntime() {
  const options = {
    modules: true,
    script: "export default {fetch(){return new Response('fixture')}}",
    compatibilityDate: "2026-08-19",
    d1Databases: { DB: "fixture" },
    bindings: {
      ADMIN_TOKEN: "local-admin-token-with-32-characters",
      NODE_KEYS: JSON.stringify({ "alpha-vps": "a".repeat(32) }),
      REPORT_MAX_AGE_SECONDS: "300",
      DASHBOARD_BASE_URL: "https://fixture.example",
    },
  };
  const runtime = new Miniflare(convertV4MiniflareOptions(options));
  return {
    async query(sql) {
      const db = await runtime.getD1Database("DB");
      const result = await db.batch(
        splitSQL(sql).map((statement) => db.prepare(statement)),
      );
      return result[0]?.results ?? [];
    },
    async worker(entry, version) {
      const result = await build({
        entryPoints: [entry],
        bundle: true,
        write: false,
        format: "esm",
        target: "es2022",
      });
      await runtime.setOptions(
        convertV4MiniflareOptions({
          ...options,
          script: result.outputFiles[0].text,
          bindings: { ...options.bindings, APP_VERSION: version },
        }),
      );
    },
    fetch: (path, options) =>
      runtime.dispatchFetch("https://fixture.example" + path, options),
    close: () => runtime.dispose(),
  };
}
