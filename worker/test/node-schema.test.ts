import { describe, expect, it, vi } from "vitest";
import { nodeCatalogStatement, writeReportBatch } from "../src/node-schema";
import type { AgentReport, Env } from "../src/types";

const report = {
  node: { id: "alpha-vps", display_name: "Alpha" },
} as AgentReport;
function fixture(errors: (string | null)[]) {
  const batch = vi.fn(async (_statements: D1PreparedStatement[]) => {
    const message = errors.shift();
    if (message) throw Error(message);
    return [];
  });
  const prepare = vi.fn((sql: string) => ({
    bind: (...values: unknown[]) => ({ sql, values }),
  }));
  const env = { DB: { batch, prepare } } as unknown as Env;
  const statements = [
    nodeCatalogStatement(env, report, 1),
    { sql: "remaining atomic writes" } as unknown as D1PreparedStatement,
  ];
  return { env, batch, statements };
}

describe("report writes while node identity schema is upgrading", () => {
  it("retries an atomic batch only for the old column constraint", async () => {
    const h = fixture([
      "D1_ERROR: NOT NULL constraint failed: node_catalog.short_mark",
      null,
    ]);
    await writeReportBatch(h.env, report, 1, h.statements);
    expect(h.batch).toHaveBeenCalledTimes(2);
    const retry = h.batch.mock.calls[1][0];
    expect(retry[0]).toMatchObject({
      sql: expect.stringContaining("short_mark"),
      values: expect.arrayContaining(["alph"]),
    });
    expect(retry[1]).toBe(h.statements[1]);
  });

  it("recovers if cleanup removes the column between the two attempts", async () => {
    const h = fixture([
      "NOT NULL constraint failed: node_catalog.short_mark",
      "D1_ERROR: table node_catalog has no column named short_mark",
      null,
    ]);
    await writeReportBatch(h.env, report, 1, h.statements);
    expect(h.batch).toHaveBeenCalledTimes(3);
    expect(h.batch).toHaveBeenLastCalledWith(h.statements);
  });

  it("does not retry unrelated failures", async () => {
    for (const errors of [
      ["database unavailable"],
      [
        "NOT NULL constraint failed: node_catalog.short_mark",
        "database unavailable",
      ],
    ]) {
      const expectedCalls = errors.length;
      const h = fixture(errors);
      await expect(
        writeReportBatch(h.env, report, 1, h.statements),
      ).rejects.toThrow("database unavailable");
      expect(h.batch).toHaveBeenCalledTimes(expectedCalls);
    }
  });

  it("uses one current-schema batch after cleanup", async () => {
    const h = fixture([null]);
    await writeReportBatch(h.env, report, 1, h.statements);
    expect(h.batch).toHaveBeenCalledTimes(1);
    expect(h.statements[0]).toMatchObject({
      sql: expect.not.stringContaining("short_mark"),
    });
  });
});
