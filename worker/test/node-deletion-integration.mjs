import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";

// Run only against the isolated Wrangler fixture database. Discover tables from
// SQLite so adding a new node-owned table without deletion support fails here.
export async function testPermanentDeletion({ query, baseUrl }) {
  const id = "purge-fixture",
    peer = "alpha-vps",
    probe = "purge-link";
  const now = Math.floor(Date.now() / 1000),
    marker = now + 3600;
  const sql = (value) =>
    value === null
      ? "NULL"
      : typeof value === "number"
        ? String(value)
        : "'" + String(value).replaceAll("'", "''") + "'";
  const names = query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
  );
  const descriptions = query(
    names.map((row) => "PRAGMA table_info(" + row.name + ")").join(";"),
    true,
  );
  const schema = names.map((row, index) => ({
    ...row,
    columns: descriptions[index].results.map((column) => ({
      ...column,
      default: column.dflt_value,
    })),
  }));
  const tables = schema.filter((table) =>
    table.columns.some((column) => column.name === "node_id"),
  );
  const insert = (name, overrides = {}) => {
    const table = schema.find((table) => table.name === name);
    const columns = table.columns.filter(
      (column) =>
        !(column.name === "id" && column.pk && column.type === "INTEGER"),
    );
    const values = columns.map((column) => {
      const key = column.name;
      if (Object.hasOwn(overrides, key)) return sql(overrides[key]);
      if (key === "node_id") return sql(id);
      if (["severity", "offline_severity", "ip_change_severity"].includes(key))
        return sql("P1");
      if (key === "resolution") return sql("hour");
      if (key === "state") return sql("resolved");
      if (key === "kind")
        return sql("icmp");
      if (key === "unit") return sql("matches");
      if (key === "report_json")
        return sql(JSON.stringify({ node: { id }, probes: [] }));
      if (key.endsWith("_json"))
        return sql(key === "details_json" ? "{}" : "[]");
      if (key === "public_id") return sql(id + "-" + name);
      if (column.default !== null) return column.default;
      if (!column.notnull && !column.pk) return "NULL";
      if (column.type === "TEXT") return sql("fixture-" + name + "-" + key);
      return /_at$|bucket|timestamp|first_seen|last_seen/.test(key)
        ? String(now)
        : "1";
    });
    return (
      "INSERT INTO " +
      name +
      "(" +
      columns.map((column) => column.name).join(",") +
      ") VALUES (" +
      values.join(",") +
      ");"
    );
  };
  const beforePeer = query(
    "SELECT report_json FROM node_latest WHERE node_id=" + sql(peer),
  )[0].report_json;
  const statements = tables.map((table) =>
    insert(
      table.name,
      table.name === "node_catalog"
        ? { public_id: id, enabled: 1, retired_at: null }
        : {},
    ),
  );
  statements.push(
    insert("probe_catalog", {
      node_id: peer,
      probe_name: probe,
      public_id: probe,
      target_node_id: id,
    }),
  );
  const probeTables = [
    "probe_series_rollups",
  ];
  for (const name of probeTables)
    statements.push(insert(name, { node_id: peer, probe_name: probe }));
  const archive = JSON.stringify({
    keep: 42,
    probes: [
      { name: probe, target_node_id: id },
      { name: "kept-probe", target: "example.com" },
    ],
  });
  statements.push(
    insert("snapshots", {
      node_id: peer,
      reported_at: marker,
      report_json: archive,
    }),
  );
  statements.push(
    insert("probe_rounds", {
      node_id: peer,
      round_at: marker,
      probes_json: JSON.stringify([[probe], ["kept-probe"]]),
    }),
  );
  statements.push(
    insert("business_routes", {
      source_node_id: peer,
      target_node_id: id,
      probe_name: probe,
    }),
  );
  query(statements.join(" "));

  const endpoint = "/api/v1/admin/nodes/" + id;
  const admin = (path, method = "GET") =>
    fetch(baseUrl + path, {
      method,
      headers: { Authorization: "Bearer local-admin-token-with-32-characters" },
    });
  assert.equal((await fetch(baseUrl + endpoint + "/deletion")).status, 401);
  assert.equal(
    (await fetch(baseUrl + endpoint, { method: "DELETE" })).status,
    401,
  );
  assert.equal(
    (await admin("/api/v1/admin/nodes/alpha-vps", "DELETE")).status,
    409,
    "credentialed nodes cannot be purged",
  );
  assert.equal(
    (await admin("/api/v1/admin/nodes/revoked-vps", "DELETE")).status,
    409,
    "revocation inventory must be cleared too",
  );
  assert.equal(
    (await admin(endpoint, "DELETE")).status,
    409,
    "an active catalog must be retired first",
  );
  const preview = await (await admin(endpoint + "/deletion")).json();
  assert.ok(preview.rows >= tables.length);
  assert.deepEqual(preview.peers, [{ node_id: peer, probe_name: probe }]);
  assert.equal((await admin(endpoint + "/retire", "POST")).status, 200);
  const deleted = await admin(endpoint, "DELETE");
  assert.equal(deleted.status, 200, JSON.stringify(await deleted.json()));
  const counts = query(
    "SELECT " +
      tables
        .map(
          (table) =>
            "(SELECT COUNT(*) FROM " +
            table.name +
            " WHERE node_id=" +
            sql(id) +
            ") AS " +
            table.name,
        )
        .join(","),
  )[0];
  assert.ok(
    Object.values(counts).every((count) => count === 0),
    JSON.stringify(counts),
  );
  const remainingLinks = query(
    "SELECT " +
      [...probeTables, "probe_catalog"]
        .map(
          (name) =>
            "(SELECT COUNT(*) FROM " +
            name +
            " WHERE node_id=" +
            sql(peer) +
            " AND probe_name=" +
            sql(probe) +
            ") AS " +
            name,
        )
        .join(","),
  )[0];
  assert.ok(Object.values(remainingLinks).every((count) => count === 0));
  const raw = query(
    "SELECT report_json FROM snapshots WHERE node_id=" +
      sql(peer) +
      " AND reported_at=" +
      marker,
  )[0];
  assert.deepEqual(JSON.parse(raw.report_json), {
    keep: 42,
    probes: [{ name: "kept-probe", target: "example.com" }],
  });
  const packed = query(
    "SELECT probes_json FROM probe_rounds WHERE node_id=" +
      sql(peer) +
      " AND round_at=" +
      marker,
  )[0];
  assert.deepEqual(JSON.parse(packed.probes_json), [["kept-probe"]]);
  assert.equal(
    query(
      "SELECT COUNT(*) AS n FROM business_routes WHERE source_node_id=" +
        sql(id) +
        " OR target_node_id=" +
        sql(id),
    )[0].n,
    0,
  );
  assert.equal(
    query(
      "SELECT COUNT(*) AS n FROM metric_samples WHERE node_id=" + sql(peer),
    )[0].n > 0,
    true,
  );
  assert.equal(
    query("SELECT report_json FROM node_latest WHERE node_id=" + sql(peer))[0]
      .report_json,
    beforePeer,
    "unrelated current metrics remain untouched",
  );
  assert.equal(
    (await admin(endpoint, "DELETE")).status,
    200,
    "repeating a successful deletion is safe",
  );
  assert.equal(
    (await admin(endpoint + "/restore", "POST")).status,
    404,
    "permanent deletion cannot restore",
  );

  const stale = JSON.parse(beforePeer);
  stale.generated_at = Math.max(
    Math.floor(Date.now() / 1000),
    stale.generated_at + 1,
  );
  stale.probes = [
    {
      ...stale.probes[0],
      name: probe,
      target_node_id: id,
      category: "node-link",
      checked_at: stale.generated_at,
    },
  ];
  const body = JSON.stringify(stale),
    timestamp = String(Math.floor(Date.now() / 1000)),
    nonce = randomBytes(18).toString("hex");
  const signature = createHmac("sha256", "a".repeat(32))
    .update(timestamp + "\n" + nonce + "\n" + body)
    .digest("hex");
  const response = await fetch(baseUrl + "/api/v1/report", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "X-Vpsmon-Node": peer,
      "X-Vpsmon-Timestamp": timestamp,
      "X-Vpsmon-Nonce": nonce,
      "X-Vpsmon-Signature": "sha256=" + signature,
    },
  });
  assert.equal(response.status, 202, JSON.stringify(await response.json()));
  assert.equal(
    query(
      "SELECT COUNT(*) AS n FROM probe_catalog WHERE target_node_id=" + sql(id),
    )[0].n,
    0,
    "queued peer reports cannot recreate deleted links",
  );
  assert.deepEqual(
    JSON.parse(
      query("SELECT report_json FROM node_latest WHERE node_id=" + sql(peer))[0]
        .report_json,
    ).probes,
    [],
  );
  console.log("permanent_deletion_ok=true");
}
