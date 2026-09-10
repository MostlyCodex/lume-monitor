import { InputError, inputValue } from "./prompts.mjs";
import { withoutNode } from "./private-node-data.mjs";

/** Permanent deletion is a resumable operation, not a variant of retirement.
 * Keep only its progress until every external layer acknowledges completion.
 */
export async function deleteManagedNode(id, { state, options, prompt, io }) {
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(id)) throw Error("节点 ID 格式无效");
  await io.ensureBackend(state);
  await io.assertInventory(state);
  const summary = await io.summary(state, id);
  const original = state.nodes[id] ?? state.retiredNodes?.[id] ?? {};
  const previous = state.pendingDeletes?.[id];
  const plan = await io.plan(id);
  const known = Boolean(
    state.nodes[id] ||
      state.retiredNodes?.[id] ||
      state.nodeKeys[id] ||
      previous ||
      summary.rows,
  );
  if (!known && !plan.removals.length && !plan.updates.length) {
    io.line("该节点已无管理数据。");
    return;
  }

  const target =
    options.get("ssh") || previous?.sshTarget || original.sshTarget || "";
  const agentAbsent =
    options.get("agent-absent") === true || previous?.agentAbsent === true;
  const remote = previous?.remoteDone
    ? { sshTarget: target, agentAbsent }
    : await io.remoteChoice(target, agentAbsent, options.get("yes") === true);
  const peers = [
    ...new Set([
      ...(previous?.peers ?? []),
      ...plan.peers,
      ...(summary.peers ?? [])
        .map((peer) => peer.node_id)
        .filter((peer) => state.nodes[peer]),
    ]),
  ];
  const unmanaged = (summary.peers ?? []).filter(
    (peer) => state.nodeKeys[peer.node_id] && !state.nodes[peer.node_id],
  );
  if (unmanaged.length)
    throw Error(
      "请先接管关联节点：" +
        [...new Set(unmanaged.map((peer) => peer.node_id))].join("、"),
    );
  for (const peer of peers) if (state.nodes[peer]) await io.checkPeer(peer);
  io.line("永久删除节点：" + id);
  io.line(
    remote.agentAbsent
      ? "  VPS：按已销毁或从未安装 Agent 处理。"
      : "  VPS：" +
          remote.sshTarget +
          "；卸载 Agent，删除配置、缓存、流量状态、升级备份及专用账号。",
  );
  io.line(
    "  Worker / D1：撤销上报凭据，删除目录、监测历史、告警及关联探针数据（当前 " +
      summary.rows +
      " 行）。",
  );
  io.line("  本地：删除节点配置、恢复记录和备份，清除其他配置中的关联探针。");
  if (peers.length) io.line("  同步关联节点：" + peers.join("、"));
  io.line("无法通过菜单 8 恢复；共享 Worker、D1 和其他节点继续保留。");
  if (options.get("yes") !== true)
    await inputValue(prompt, "输入节点 ID 确认永久删除", {
      fallback: "",
      hint: "仅接受 " + id + "；/cancel 取消",
      line: io.line,
      parse: (value) => {
        if (value !== id) throw new InputError("请输入完整节点 ID：" + id);
        return value;
      },
    });

  state.pendingDeletes ||= {};
  const job = (state.pendingDeletes[id] = {
    ...previous,
    ...remote,
    peers,
    startedAt: previous?.startedAt ?? Math.floor(Date.now() / 1000),
  });
  await io.save(state);
  try {
    // Revocation precedes data erasure. A failure keeps the progress record and
    // the exact peer list, even after local configurations have been cleaned.
    delete state.nodeKeys[id];
    await io.save(state);
    await io.publishKeys(state);
    state.revokedNodeIds = (state.revokedNodeIds ?? []).filter(
      (nodeId) => nodeId !== id,
    );
    // Repeat publication on retries: a previous secret update may have failed
    // after the local list was saved.
    await io.publishRevocations(state);
    await io.retire(state, id);
    if (!job.remoteDone) {
      if (!job.agentAbsent) await io.uninstall(job.sshTarget);
      job.remoteDone = true;
      await io.save(state);
    }
    await io.clean(await io.plan(id));
    for (const peer of job.peers)
      if (state.nodes[peer]) state.nodes[peer].pendingApply = true;
    // Remove all cross-references, retaining only the pending operation.
    const cleaned = withoutNode(state, id);
    Object.keys(state).forEach((key) => delete state[key]);
    Object.assign(state, cleaned);
    state.pendingDeletes ||= {};
    state.pendingDeletes[id] = job;
    await io.save(state);
    const activePeers = job.peers.filter((peer) => state.nodes[peer]);
    await io.applyPeers(activePeers, state);
    await io.purge(state, id);
    // Deployment may create fresh backups; sweep again before acknowledging.
    await io.clean(await io.plan(id));
    delete state.pendingDeletes[id];
    if (!Object.keys(state.pendingDeletes).length) delete state.pendingDeletes;
    await io.save(state);
    io.line(
      "✓ " + id + " 已永久删除：VPS、Worker / D1 和本地管理数据清理完成。",
    );
  } catch (error) {
    await io.save(state);
    io.line("删除尚未完成；菜单 9 可继续处理 " + id + "，已完成的步骤会保留。");
    throw error;
  }
}
