import { createHmac, timingSafeEqual } from "node:crypto";

export const nodeIdPattern = /^[a-z0-9][a-z0-9_-]{0,31}$/;

// Read JSONC without interpreting comments or trailing commas inside strings.
export function parseJsonc(source) {
  let output = "", quoted = false, escaped = false;
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    if (quoted) {
      output += c;
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') { quoted = true; output += c; }
    else if (c === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      output += "\n";
    } else if (c === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      if (end < 0) throw new Error("JSONC 注释未闭合");
      i = end + 1;
      output += " ";
    } else output += c;
  }
  let clean = "";
  quoted = false; escaped = false;
  for (let i = 0; i < output.length; i += 1) {
    const c = output[i];
    if (!quoted && c === "," && /^[\s]*[}\]]/.test(output.slice(i + 1))) continue;
    clean += c;
    if (escaped) escaped = false;
    else if (quoted && c === "\\") escaped = true;
    else if (c === '"') quoted = !quoted;
  }
  return JSON.parse(clean.replace(/^\uFEFF/, ""));
}

export function workerOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Worker 地址必须是 HTTPS 根地址，不含路径、查询参数或登录信息");
  }
  return url.origin;
}

export function keyProof(id, secret) {
  return createHmac("sha256", secret).update(`lume-key-inventory-v1\n${id}`).digest("hex");
}

export function validateImportedConfig(config, id, origin) {
  if (!nodeIdPattern.test(id) || config?.node?.id !== id) throw new Error(`配置的节点 ID 与 ${id} 不一致`);
  if (typeof config.secret !== "string" || config.secret.length < 32 || config.secret.length > 256) throw new Error(`${id} 的密钥格式无效`);
  const endpoint = new URL(config.endpoint);
  if (endpoint.origin !== origin || endpoint.pathname !== "/api/v1/report" || endpoint.search || endpoint.hash || endpoint.username || endpoint.password) {
    throw new Error(`${id} 的上报地址与所选 Worker 不一致`);
  }
  for (const field of ["services", "probes"]) {
    if (!Array.isArray(config[field])) throw new Error(`${id} 的 ${field} 必须为数组`);
  }
  return config;
}

export function verifyKeyInventory(nodeKeys, inventory) {
  if (!Array.isArray(inventory?.keys) || !Array.isArray(inventory?.revoked_node_ids)) throw new Error("后端密钥清单格式无效");
  const expected = inventory.keys.map((entry) => entry.node_id).sort();
  const actual = Object.keys(nodeKeys).sort();
  if (new Set(expected).size !== expected.length || JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error("本地密钥映射与线上完整清单不一致；已停止，避免覆盖其他节点");
  }
  for (const entry of inventory.keys) {
    if (!nodeIdPattern.test(entry.node_id) || !/^[a-f0-9]{64}$/.test(entry.proof || "") ||
        typeof nodeKeys[entry.node_id] !== "string" || nodeKeys[entry.node_id].length < 32 || nodeKeys[entry.node_id].length > 256 ||
        !timingSafeEqual(Buffer.from(keyProof(entry.node_id, nodeKeys[entry.node_id])), Buffer.from(entry.proof))) {
      throw new Error(`节点 ${entry.node_id} 的密钥与线上不一致`);
    }
  }
  if (!inventory.revoked_node_ids.every((id) => nodeIdPattern.test(id))) throw new Error("撤销清单格式无效");
}

// A peer may have been edited since retirement. Never overwrite a reused name.
export function restorePeerProbes(current, archived) {
  const probes = [...current];
  for (const probe of archived) {
    const existing = probes.find((entry) => entry.name === probe.name);
    if (existing && JSON.stringify(existing) !== JSON.stringify(probe)) throw new Error(`探针 ${probe.name} 已被修改，请先解决名称冲突`);
    if (!existing) probes.push(probe);
  }
  return probes;
}

// Save progress before each external operation so failed steps remain retryable.
export async function applyPending(state, ids, { save, deploy }) {
  for (const id of ids) {
    if (!state.nodes[id]) throw new Error(`未知节点 ${id}`);
    state.nodes[id].pendingApply = true;
  }
  await save(state);
  for (const id of ids) {
    await deploy(id);
    delete state.nodes[id].pendingApply;
    await save(state);
  }
}
