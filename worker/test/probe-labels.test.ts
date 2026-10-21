import { describe, expect, it } from "vitest";
import { probeDisplayName } from "../src/probe-labels";
import type { NodeId } from "../src/types";

const nodes = new Map([["seednet-tw" as NodeId, "Seednet 台湾"]]);
const probe = (overrides: Partial<Parameters<typeof probeDisplayName>[0]>) => ({
  probe_name: "tcp",
  category: "external",
  target_node_id: null,
  display_name: "Configured",
  ...overrides,
});

describe("probe display names", () => {
  it("names a node link after its target node", () => {
    expect(probeDisplayName(probe({ category: "node-link", target_node_id: "seednet-tw" as NodeId }), nodes)).toBe(
      "Seednet 台湾",
    );
  });

  it("keeps the configured label when the target node is not in the catalog", () => {
    expect(probeDisplayName(probe({ category: "node-link", target_node_id: "gone" as NodeId }), nodes)).toBe("Configured");
  });

  it("names carrier references by carrier only", () => {
    expect(
      ["carrier_ct", "carrier_2_cu", "carrier_cm"].map((name) =>
        probeDisplayName(probe({ category: "carrier-reference", probe_name: name, display_name: "北京电信 · TCP 80" }), nodes),
      ),
    ).toEqual(["电信", "联通", "移动"]);
  });

  it("leaves other probes as configured", () => {
    expect(probeDisplayName(probe({ probe_name: "cloudflare" }), nodes)).toBe("Configured");
  });
});
