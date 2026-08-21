import { describe, expect, it } from "vitest";
import { historyBucketSeconds, type HistoryHours } from "../src/dashboard-data";

describe("dashboard history display resolution", () => {
  it.each([
    [6, false, 300],
    [24, false, 300],
    [6, true, 60],
    [24, true, 60],
    [168, false, 3600],
    [168, true, 3600],
    [720, true, 3600],
    [2160, true, 86400],
  ] as Array<[HistoryHours, boolean, number]>)(
    "uses %i-hour history with selectedNode=%s at %i-second resolution",
    (hours, selectedNode, expected) => {
      expect(historyBucketSeconds(hours, selectedNode)).toBe(expected);
    },
  );
});
