import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  nodeIdentityCleanupSQL,
  nodeIdentityRollbackSQL,
} from "../../tools/schema-lifecycle.mjs";

export function contractIdentity(query, legacy = false) {
  const migrationName = legacy
    ? "0012_node_identity.sql"
    : "0007_node_identity.sql";
  const folder = legacy ? "migrations-v3-contract" : "migrations-contract";
  const source = readFileSync(
    new URL(`../${folder}/${migrationName}`, import.meta.url),
    "utf8",
  );
  const columns = query("PRAGMA table_info(node_catalog)").map(
    (column) => column.name,
  );
  query(nodeIdentityCleanupSQL(source, columns, migrationName));
}

// Exercise schema transitions while the real Worker continues to accept HTTP
// reports. This database and its signing keys belong only to the local fixture.
export async function testSchemaTransitions({ query, baseUrl }) {
  const columns = () =>
    query("PRAGMA table_info(node_catalog)").map((column) => column.name);
  assert.ok(
    columns().includes("short_mark"),
    "compatible migrations must retain the column used by the old Worker",
  );
  const node = query(
    "SELECT short_mark FROM node_catalog WHERE node_id='alpha-vps'",
  )[0];
  assert.match(node.short_mark, /^[A-Za-z0-9]{1,4}$/);
  const report = JSON.parse(
    query("SELECT report_json FROM node_latest WHERE node_id='alpha-vps'")[0]
      .report_json,
  );
  const send = async () => {
    report.generated_at += 1;
    const body = JSON.stringify(report);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(16).toString("hex");
    const signature = createHmac("sha256", "a".repeat(32))
      .update(`${timestamp}\n${nonce}\n${body}`)
      .digest("hex");
    const response = await fetch(`${baseUrl}/api/v1/report`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Vpsmon-Node": "alpha-vps",
        "X-Vpsmon-Timestamp": timestamp,
        "X-Vpsmon-Nonce": nonce,
        "X-Vpsmon-Signature": `sha256=${signature}`,
      },
      body,
    });
    assert.equal(response.status, 202, await response.text());
    const latest = query(
      "SELECT report_json FROM node_latest WHERE node_id='alpha-vps'",
    );
    assert.equal(
      JSON.parse(latest[0].report_json).generated_at,
      report.generated_at,
    );
    assert.equal(
      Object.hasOwn(JSON.parse(latest[0].report_json).node, "short_mark"),
      false,
    );
  };
  await send();
  contractIdentity(query);
  assert.ok(!columns().includes("short_mark"));
  await send();

  // The supported rollback prepares the legacy column before switching code.
  query(nodeIdentityRollbackSQL(columns()));
  assert.ok(columns().includes("short_mark"));
  query("UPDATE node_catalog SET short_mark='OLD' WHERE node_id='alpha-vps'");
  assert.equal(
    query("SELECT short_mark FROM node_catalog WHERE node_id='alpha-vps'")[0]
      .short_mark,
    "OLD",
  );
  await send();

  // Historical markers survive rollback: cleanup must inspect physical schema,
  // otherwise the next deployment would incorrectly skip this contraction.
  const marker =
    "SELECT COUNT(*) AS n FROM d1_migrations WHERE name='0007_node_identity.sql'";
  assert.equal(query(marker)[0].n, 1);
  contractIdentity(query);
  assert.ok(!columns().includes("short_mark"));
  await send();
  contractIdentity(query);
  assert.equal(query(marker)[0].n, 1);
  console.log("schema_expand_contract_rollback_ok=true");
}
