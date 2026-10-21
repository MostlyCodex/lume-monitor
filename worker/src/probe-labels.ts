import type { NodeId } from "./types";

const CARRIER_NAMES: Record<string, string> = { ct: "电信", cu: "联通", cm: "移动" };

interface LabelledProbe {
  probe_name: string;
  category: string;
  target_node_id: NodeId | null;
  display_name: string;
}

/**
 * The name a probe is shown under. A link to another node is named after that
 * node, so renaming the node renames its links. A carrier reference is named
 * after its carrier only; which city the target sits in is not tracked.
 * Anything else keeps the label it was configured with.
 */
export function probeDisplayName(probe: LabelledProbe, nodeNames: ReadonlyMap<NodeId, string>): string {
  if (probe.category === "node-link" && probe.target_node_id) {
    const target = nodeNames.get(probe.target_node_id);
    if (target) return target;
  }
  if (probe.category === "carrier-reference") {
    const carrier = /_(ct|cu|cm)$/.exec(probe.probe_name)?.[1];
    if (carrier) return CARRIER_NAMES[carrier];
  }
  return probe.display_name;
}
