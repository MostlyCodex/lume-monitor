import { describe, expect, it } from "vitest";
import { maskIp } from "../src/index";

describe("IP masking", () => {
  it("masks IPv4 last octet", () => {
    expect(maskIp("203.0.113.45")).toBe("203.0.113.x");
  });

  it("masks IPv6 to a /64-style prefix", () => {
    expect(maskIp("2001:db8:1:2:3:4:5:6")).toBe("2001:db8:1:2::/64");
  });
});
