import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { prepareDatabase, DATABASE_SCHEMA } from "../../tools/database.mjs";
import { localRuntime } from "./local-runtime.mjs";

async function fixture(check) {
  const runtime = await localRuntime();
  try {
    await check(runtime.query);
  } finally {
    await runtime.close();
  }
}

export async function testDatabaseInitialization() {
  const source = await readFile(
    new URL("../database/schema.sql", import.meta.url),
    "utf8",
  );
  await fixture(async (query) => {
    await assert.rejects(
      prepareDatabase({
        query,
        readSQL: async () => source + "\nINSERT INTO missing_table VALUES (1);",
      }),
      /missing_table/,
    );
    assert.equal(
      (await query("SELECT name FROM sqlite_master WHERE name='node_catalog'"))
        .length,
      0,
      "initialization failure must roll back all tables",
    );
    await prepareDatabase({ query });
    assert.equal(
      (await query("SELECT value FROM settings WHERE key='database_schema'"))[0]
        .value,
      DATABASE_SCHEMA,
    );
    await query("INSERT INTO settings VALUES ('fixture', 'preserved', 1)");
    await prepareDatabase({
      query,
      readSQL: async () => source.replaceAll("\n", "\r\n"),
    });
    assert.equal(
      (await query("SELECT value FROM settings WHERE key='fixture'"))[0].value,
      "preserved",
    );
    await query("ALTER TABLE node_catalog ADD COLUMN unexpected TEXT");
    await assert.rejects(prepareDatabase({ query }), /结构与当前版本不一致/);
    assert.equal(
      (await query("SELECT value FROM settings WHERE key='fixture'"))[0].value,
      "preserved",
    );
  });
  await fixture(async (query) => {
    await query(
      "CREATE TABLE unrelated(value TEXT); INSERT INTO unrelated VALUES ('preserved');",
    );
    await assert.rejects(prepareDatabase({ query }), /绑定空数据库/);
    assert.deepEqual(await query("SELECT value FROM unrelated"), [
      { value: "preserved" },
    ]);
    assert.equal(
      (await query("SELECT name FROM sqlite_master WHERE name='node_catalog'"))
        .length,
      0,
    );
  });
  await fixture(async (query) => {
    await prepareDatabase({ query });
    await query(
      "UPDATE settings SET value='different' WHERE key='database_schema'",
    );
    await assert.rejects(prepareDatabase({ query }), /结构标识不匹配/);
  });
  console.log("database_initialization_retry_and_preservation_ok=true");
}
if (process.argv[1]?.endsWith("database-initialization.mjs"))
  await testDatabaseInitialization();
