import { lstat, readdir, readFile, realpath, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

export function withoutNode(value, id) {
  if (Array.isArray(value))
    return value
      .filter((item) => item?.node_id !== id && item?.target_node_id !== id)
      .map((item) => withoutNode(item, id));
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (
      [
        "nodes",
        "nodeKeys",
        "retiredNodes",
        "pendingDeletes",
        "peerProbes",
      ].includes(key) &&
      child &&
      typeof child === "object" &&
      !Array.isArray(child)
    ) {
      result[key] = Object.fromEntries(
        Object.entries(child)
          .filter(([nodeId]) => nodeId !== id)
          .map(([nodeId, item]) => [nodeId, withoutNode(item, id)]),
      );
    } else if (
      ["revokedNodeIds", "revoked_node_ids", "peers"].includes(key) &&
      Array.isArray(child)
    )
      result[key] = child.filter((nodeId) => nodeId !== id);
    else result[key] = withoutNode(child, id);
  }
  return result;
}

// Only Lume-owned configuration directories and JSON backups are inspected.
// Reject symlinks and unreadable files instead of reporting an incomplete purge
// as successful or following a path outside the private directory.
export async function nodeFilePlan(root, id) {
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(id)) throw Error("Invalid node ID");
  const canonical = await realpath(root);
  const updates = [],
    removals = [],
    peers = new Set();
  const temporaryJson = /^\.(?:state|config)\.json\.[a-f0-9]{12}\.tmp$/;
  async function inspect(directory, category) {
    let entries;
    try {
      if (
        (await lstat(directory)).isSymbolicLink() ||
        (await realpath(directory)) !== directory
      )
        throw Error("无法安全清理路径：" + directory);
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      if (category === "temporary" && !temporaryJson.test(entry.name)) continue;
      const path = join(directory, entry.name);
      const resolved = await realpath(path);
      if (entry.isSymbolicLink() || !resolved.startsWith(canonical + sep))
        throw Error("无法安全清理路径：" + path);
      if (entry.isDirectory()) {
        await inspect(path, category);
        continue;
      }
      if (!entry.name.endsWith(".json") && !temporaryJson.test(entry.name))
        continue;
      let original;
      try {
        original = JSON.parse(await readFile(path, "utf8"));
      } catch {
        throw Error("无法读取配置或备份，请修复后重试：" + path);
      }
      if (original?.node?.id === id || original?.node_id === id) {
        removals.push(path);
        continue;
      }
      const next = withoutNode(original, id);
      if (JSON.stringify(original) !== JSON.stringify(next)) {
        updates.push({ path, value: next });
        if (category === "nodes" && original?.node?.id)
          peers.add(original.node.id);
      }
    }
  }
  await inspect(canonical, "temporary");
  for (const category of ["nodes", "retired", "backups"])
    await inspect(join(canonical, category), category);
  for (const category of ["nodes", "retired"]) {
    const path = resolve(canonical, category, id);
    try {
      const info = await lstat(path);
      if (info.isSymbolicLink() || (await realpath(path)) !== path)
        throw Error("无法安全清理路径：" + path);
      removals.push(path);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return {
    root: canonical,
    updates,
    removals: [...new Set(removals)],
    peers: [...peers],
  };
}

export async function applyNodeFilePlan(plan, writeJson) {
  async function check(path) {
    try {
      const actual = await realpath(path);
      if (actual !== path || !actual.startsWith(plan.root + sep))
        throw Error("无法安全清理路径：" + path);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  for (const update of plan.updates) {
    // A disappearing file requires a new plan; never recreate it through a
    // parent directory that changed since the preview.
    await lstat(update.path);
    await check(update.path);
    await writeJson(update.path, update.value);
  }
  for (const path of plan.removals) {
    await check(path);
    await rm(path, { recursive: true, force: true });
  }
}
