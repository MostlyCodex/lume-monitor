import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { prepareDatabase, cleanDatabase } from "../../tools/database.mjs";
import { localRuntime } from "./local-runtime.mjs";

const readSQL = (file) =>
  readFile(new URL("../database/" + file, import.meta.url), "utf8");
const history = "SELECT name FROM d1_migrations ORDER BY name";
async function fixture(check) {
  const runtime = await localRuntime();
  try {
    await check(runtime.query);
  } finally {
    await runtime.close();
  }
}

// Run against workerd's D1, including transaction rollback after real SQL failure.
export async function testDatabaseUpdates() {
  await fixture(async (query) => {
    let fail = true;
    const options = {
      query,
      readSQL: async (file) =>
        (await readSQL(file)) +
        (fail && file.includes("0003_")
          ? "\nINSERT INTO missing_table VALUES (1);"
          : ""),
    };
    await assert.rejects(prepareDatabase(options), /missing_table/);
    assert.equal(
      (
        await query(
          "SELECT name FROM sqlite_master WHERE name='probe_rounds_v3'",
        )
      ).length,
      0,
      "failed batch left a new table",
    );
    const before = await query(history);
    assert.ok(before.some((row) => row.name === "0002_probe_quality.sql"));
    assert.ok(
      !before.some((row) => row.name === "0003_packed_probe_rounds.sql"),
    );
    fail = false;
    await prepareDatabase(options);
    const records = await query(history);
    await prepareDatabase({ query });
    assert.deepEqual(
      await query(history),
      records,
      "retry repeated completed updates",
    );
    await cleanDatabase({ query });
    await cleanDatabase({ query });
    await prepareDatabase({ query });
    assert.ok(
      !(await query("PRAGMA table_info(node_catalog)")).some(
        (row) => row.name === "short_mark",
      ),
    );
  });
  for (const partial of [true, false])
    await fixture(async (query) => {
      await query(
        await readFile(
          new URL("fixtures/v3-before-0006.sql", import.meta.url),
          "utf8",
        ),
      );
      // Reproduce already-deployed v3 history without using the new helper.
      await query(await readSQL("upgrade-v3.sql"));
      await query(
        "CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY, name TEXT UNIQUE, applied_at TEXT); INSERT INTO d1_migrations(name) VALUES ('0006_generic_nodes.sql');",
      );
      const names = [
        "probe_quality",
        "packed_probe_rounds",
        "icmp_only",
        "optional_observers",
        "node_retirement",
      ];
      for (let i = 0; i < (partial ? 2 : 5); i++) {
        await query(
          await readSQL(
            "updates/" +
              String(i + 2).padStart(4, "0") +
              "_" +
              names[i] +
              ".sql",
          ),
        );
        await query(
          "INSERT INTO d1_migrations(name) VALUES ('" +
            String(i + 7).padStart(4, "0") +
            "_" +
            names[i] +
            ".sql');",
        );
      }
      const oldData = await query("SELECT * FROM node_latest");
      await prepareDatabase({ query });
      assert.deepEqual(await query("SELECT * FROM node_latest"), oldData);
      assert.equal(
        (
          await query(
            "SELECT display_name FROM node_catalog WHERE node_id='legacy-fixture'",
          )
        )[0].display_name,
        "Legacy Fixture",
      );
      const records = await query(history);
      assert.ok(records.some((row) => row.name === "0002_probe_quality.sql"));
      assert.ok(records.some((row) => row.name === "0007_probe_quality.sql"));
      await prepareDatabase({ query });
      assert.deepEqual(await query(history), records);
    });
  await fixture(async (query) => {
    await query("CREATE TABLE unrelated(secret TEXT);");
    await assert.rejects(prepareDatabase({ query }), /不是空库/);
    assert.equal(
      (await query("SELECT name FROM sqlite_master WHERE name='d1_migrations'"))
        .length,
      0,
    );
  });
  await fixture(async (query) => {
    await prepareDatabase({ query, historyTable: "lume_updates" });
    await cleanDatabase({ query, historyTable: "lume_updates" });
    await prepareDatabase({ query, historyTable: "lume_updates" });
    assert.ok((await query("SELECT name FROM lume_updates")).length > 5);
  });
  console.log("database_initialization_upgrade_retry_ok=true");
}

if (process.argv[1]?.endsWith("database-updates.mjs"))
  await testDatabaseUpdates();
