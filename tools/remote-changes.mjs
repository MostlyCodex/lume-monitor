const accountPath = /^\/etc\/(?:passwd|group|shadow|gshadow|subuid|subgid)$/;
const directoryPath = /^\/(?:etc\/vpsmon|opt\/vpsmon|var\/lib\/vpsmon|etc\/systemd\/system\/vpsmon-(?:agent\.service|nftables-snapshot\.(?:service|timer))\.d)$/;
const managedPath = /^\/(?:opt\/vpsmon\/vpsmon-agent|etc\/vpsmon\/config\.json|etc\/systemd\/system\/(?:[a-zA-Z0-9_.@-]+\.(?:wants|requires)\/)?vpsmon-(?:agent\.service|nftables-snapshot\.(?:service|timer))|var\/lib\/vpsmon\/(?:nftables-counters\.json|pending\.json|traffic\.json|upgrade-backup\.[0-9]{8}T[0-9]{6}Z))$/;
const lineRanges = /^(?:-|[1-9][0-9]*(?:-[1-9][0-9]*)?(?:,[1-9][0-9]*(?:-[1-9][0-9]*)?)*)$/;
const actions = { added: "新增", changed: "更新", removed: "删除", attributes: "属性", backup: "备份", pruned: "清理", entries: "账号条目" };
const kinds = new Set(["text", "binary", "link", "directory"]);

// Only metadata crosses the SSH boundary: never include configuration lines,
// diffs, secret values or arbitrary remote output in a change summary.
export function parseRemoteChanges(raw) {
  const rows = String(raw).trim().split(/\r?\n/);
  if (rows.shift() !== "LUME_CHANGES_V1" || rows.at(-1) !== "END") throw Error("远端变更清单不完整");
  rows.pop();
  return rows.map(row => {
    const fields = row.split("\t");
    if (fields[0] === "service" && fields.length === 4 && fields[1] === "vpsmon-agent.service" && fields.slice(2).every(value => /^[a-z-]+\/[a-z-]+$/.test(value))) {
      return { action: "service", path: fields[1], before: fields[2], after: fields[3] };
    }
    const [action, path, kind, before, after] = fields;
    if (fields.length !== 5 || !Object.hasOwn(actions, action) || !(managedPath.test(path) || (kind === "directory" && directoryPath.test(path)) || (action === "entries" && kind === "text" && accountPath.test(path))) || !kinds.has(kind) || !lineRanges.test(before) || !lineRanges.test(after)) throw Error("远端变更清单格式无效");
    return { action, path, kind, before, after };
  });
}

export function formatRemoteChange(change) {
  const { action, path, kind, before, after } = change;
  if (action === "service") return `  服务  ${path}  ${before} → ${after}`;
  if (action === "entries") return `  账号条目  ${path}（删除原行 ${before}）`;
  let location = path;
  if (kind === "text") {
    if (action === "removed") location += before === "-" ? "（空文件）" : `（原行 ${before}）`;
    else if (action === "attributes") location += "（权限或属主）";
    else if (after !== "-") location += `:${after}${before !== "-" && before !== after ? `（原行 ${before}）` : ""}`;
    else if (before !== "-") location += `（删除原行 ${before}）`;
    else location += "（空文件）";
  } else location += `（${{binary:"二进制，无行号",link:"符号链接",directory:"目录"}[kind]}）`;
  return `  ${actions[action]}  ${location}`;
}

export function createRemoteChangeLog(line = console.log) {
  let entries = [];
  return {
    record(target, raw) {
      try { entries.push({ target, changes: parseRemoteChanges(raw) }); }
      catch { entries.push({ target, unavailable: true }); }
    },
    unavailable(target) { entries.push({ target, unavailable: true }); },
    flush() {
      const completed = entries;
      entries = [];
      for (const entry of completed) {
        line(`VPS 变更 · ${entry.target}`);
        if (entry.unavailable) line("  未取回完整变更清单，请核对远端文件与服务状态。");
        else if (!entry.changes.length) line("  未发现受管文件或 Agent 服务状态变化。");
        else entry.changes.forEach(change => line(formatRemoteChange(change)));
      }
    },
  };
}
