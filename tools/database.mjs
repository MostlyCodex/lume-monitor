import { readFile } from "node:fs/promises";

export const DATABASE_SCHEMA = "lume-1";
const schemaFile = new URL("../worker/database/schema.sql", import.meta.url);
const normalize = (sql) => sql.replace(/\s+/g, " ").trim().replace(/;$/, "");

/** Initialization is one atomic D1 batch. An existing database must exactly
 * match the current definition; deployment never resets user data implicitly. */
export async function prepareDatabase({
  query,
  line = () => {},
  readSQL = () => readFile(schemaFile, "utf8"),
}) {
  const source = await readSQL();
  const definitions = new Map(
    [...source.matchAll(/\bCREATE (?:TABLE|INDEX) (\w+)[^;]+;/gi)].map(
      ([sql, name]) => [name, normalize(sql)],
    ),
  );
  if (!definitions.size) throw Error("数据库结构文件为空");
  const objects = await query(
    "SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL " +
      "AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*'",
  );
  if (!objects.length) {
    line("初始化数据库…");
    await query(source);
  } else if (
    objects.length !== definitions.size ||
    objects.some(({ name, sql }) => definitions.get(name) !== normalize(sql))
  ) {
    throw Error(
      "D1 结构与当前版本不一致。请绑定空数据库后重新部署；现有数据未改动。",
    );
  }
  const rows = await query(
    "SELECT value FROM settings WHERE key='database_schema'",
  );
  if (rows[0]?.value !== DATABASE_SCHEMA)
    throw Error("数据库结构标识不匹配，请核对 D1 配置。");
  line("✓ 数据库已就绪");
}
