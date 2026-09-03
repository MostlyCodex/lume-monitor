import { describe, expect, it } from "vitest";
import { canonicalMessage, constantTimeEqual, hmacHex, parseNodeKeys, parseRevokedNodeIds } from "../src/auth";

describe("report authentication", () => {
  it("uses a stable canonical message", () => {
    expect(canonicalMessage("123", "nonce", "{}")).toBe("123\nnonce\n{}");
  });

  it("creates a deterministic SHA-256 HMAC", async () => {
    expect(await hmacHex("secret", "message")).toBe(
      "8b5f48702995c1598c573db1e21866a9b825d4a794d169d7060a03605796360b",
    );
  });

  it("compares equal-length strings without early content exits", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "ab")).toBe(false);
  });

  it("accepts arbitrary safe node slugs", () => {
    const secret = "x".repeat(32);
    expect(parseNodeKeys(JSON.stringify({ "my-vps-01": secret, "future_node": secret }))).toEqual({
      "my-vps-01": secret,
      future_node: secret,
    });
    expect(() => parseNodeKeys(JSON.stringify({ "Invalid Node": secret }))).toThrow();
    expect(() => parseNodeKeys(JSON.stringify({ "my-vps-01": "short" }))).toThrow();
  });

  it("parses a strict node revocation list", () => {
    expect([...parseRevokedNodeIds('["retired-vps","old_node","retired-vps"]')]).toEqual([
      "retired-vps",
      "old_node",
    ]);
    expect(parseRevokedNodeIds(undefined).size).toBe(0);
    expect(() => parseRevokedNodeIds('{"retired-vps":true}')).toThrow();
    expect(() => parseRevokedNodeIds('["Invalid Node"]')).toThrow();
  });
});
