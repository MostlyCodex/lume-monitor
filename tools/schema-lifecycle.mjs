/** Deploy code that supports both schemas before removing any old columns. */
export async function deployInPhases({ expand, deploy, verify, contract }) {
  await expand();
  const result = await deploy();
  await verify(result);
  await contract();
  return result;
}

export function nodeIdentityCleanupSQL(
  source,
  columns,
  migrationName,
  migrationTable = "d1_migrations",
) {
  if (
    !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(migrationTable) ||
    !/^\d+_node_identity\.sql$/.test(migrationName)
  )
    throw Error("Invalid migration identifier");
  // A previous attempt or a rollback may have changed the schema while the
  // historical migration marker remained applied. Inspect actual columns.
  const body = columns.includes("short_mark")
    ? source
    : source.replace(
        /^ALTER TABLE node_catalog DROP COLUMN short_mark;\s*$/m,
        "",
      );
  return (
    body +
    "\nINSERT OR IGNORE INTO " +
    migrationTable +
    "(name) VALUES ('" +
    migrationName +
    "');\n"
  );
}

export function nodeIdentityRollbackSQL(columns) {
  const statements = [];
  if (!columns.includes("short_mark"))
    statements.push(
      "ALTER TABLE node_catalog ADD COLUMN short_mark TEXT NOT NULL DEFAULT '';",
    );
  // Reconstruct a valid display placeholder, not previously deleted labels.
  // Only the explicit rollback path restores this storage compatibility field.
  statements.push(
    "UPDATE node_catalog SET short_mark=substr(replace(replace(node_id,'_',''),'-',''),1,4) WHERE short_mark='';",
  );
  return statements.join("\n");
}

export async function rollbackWithSchema({ prepare, rollback, verify }) {
  await prepare();
  await rollback();
  await verify();
}
