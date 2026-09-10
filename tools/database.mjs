import { readFile, readdir } from "node:fs/promises";
import { nodeIdentityCleanupSQL } from "./schema-lifecycle.mjs";

const directory = new URL("../worker/database/", import.meta.url);
// Historical names remain in D1. Both installation histories now share one
// update list; these aliases only translate completed work, never replay it.
const aliases = {
  "0002_probe_quality.sql": "0007_probe_quality.sql",
  "0003_packed_probe_rounds.sql": "0008_packed_probe_rounds.sql",
  "0004_icmp_only.sql": "0009_icmp_only.sql",
  "0005_optional_observers.sql": "0010_optional_observers.sql",
  "0006_node_retirement.sql": "0011_node_retirement.sql",
};
const initial = "0001_initial.sql";
const bridge = "0006_generic_nodes.sql";

function tableName(value) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value))
    throw Error("数据库更新记录表名称无效");
  return value;
}
function marker(name, table) {
  if (!/^[a-zA-Z0-9_-]+\.sql$/.test(name)) throw Error("数据库更新名称无效");
  return `INSERT OR IGNORE INTO ${tableName(table)}(name) VALUES ('${name}');`;
}
export async function databaseShape(query) {
  const rows = await query(
    "SELECT m.name AS table_name, p.name AS column_name FROM sqlite_master AS m JOIN pragma_table_info(m.name) AS p WHERE m.type='table' AND m.name NOT LIKE 'sqlite_%' AND m.name NOT LIKE '_cf_%'",
  );
  const tables = new Map();
  for (const row of rows) {
    if (!tables.has(row.table_name)) tables.set(row.table_name, new Set());
    tables.get(row.table_name).add(row.column_name);
  }
  return tables;
}

/** All SQL and its completion marker execute in one D1 batch, as Wrangler's
 * built-in updater does. Unknown databases stop before any DDL is issued. */
export async function prepareDatabase({
  query,
  historyTable = "d1_migrations",
  line = () => {},
  readSQL = (file) => readFile(new URL(file, directory), "utf8"),
}) {
  const table = tableName(historyTable);
  const shape = await databaseShape(query);
  const applied = new Set(
    shape.has(table)
      ? (await query(`SELECT name FROM ${table}`)).map((row) => row.name)
      : [],
  );
  const node = shape.get("node_catalog");
  const fresh = !node;
  if (
    fresh &&
    (applied.size || [...shape.keys()].some((name) => name !== table))
  )
    throw Error("数据库不是空库，也不是可识别的 Lume 数据库，已停止初始化");
  const legacy = node && !node.has("offline_severity");
  if (node && !legacy && !applied.has(initial) && !applied.has(bridge))
    throw Error("缺少已知数据库更新记录，已停止；请核对所选 D1");
  if (
    legacy &&
    (applied.has(bridge) ||
      !node.has("service_name") ||
      !shape.has("business_routes"))
  )
    throw Error("旧数据库结构与更新记录不一致，已停止升级");
  await query(
    `CREATE TABLE IF NOT EXISTS ${table}(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL);`,
  );
  const apply = async (file, names) => {
    line(`应用数据库更新：${file}`);
    const source = await readSQL(file);
    await query(
      source + "\n" + names.map((name) => marker(name, table)).join("\n"),
    );
    names.forEach((name) => applied.add(name));
  };
  if (fresh) await apply("initialize.sql", [initial]);
  else if (legacy) await apply("upgrade-v3.sql", [bridge, initial]);
  else if (!applied.has(initial)) {
    await query(marker(initial, table));
    applied.add(initial);
  }
  const files = (await readdir(new URL("updates/", directory)))
    .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    if (aliases[file] && applied.has(aliases[file]))
      await query(marker(file, table));
    else
      await apply("updates/" + file, [
        file,
        ...(aliases[file] ? [aliases[file]] : []),
      ]);
    applied.add(file);
  }
  line("✓ 数据库结构已就绪");
}

export async function cleanDatabase({ query, historyTable = "d1_migrations" }) {
  const source = await readFile(
    new URL("cleanup/0007_node_identity.sql", directory),
    "utf8",
  );
  const columns = (await query("PRAGMA table_info(node_catalog)")).map(
    (row) => row.name,
  );
  await query(
    nodeIdentityCleanupSQL(
      source,
      columns,
      "0007_node_identity.sql",
      historyTable,
    ) +
      "\n" +
      marker("0012_node_identity.sql", historyTable),
  );
}
