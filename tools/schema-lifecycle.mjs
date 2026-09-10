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
