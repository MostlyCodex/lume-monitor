// Kept in step with the real Worker/Agent matrix in worker/test/version-compatibility.mjs.
// A version label identifies a tested upstream contract, not arbitrary modified code.
export const rollbackVersions = ["1.0.1", "1.0.2", "1.0.3"];
export function workerVersion(metadata) {
  return metadata?.resources?.bindings?.find(
    (binding) =>
      binding.type === "plain_text" && binding.name === "APP_VERSION",
  )?.text;
}
export function assertRollbackVersion(version, columns) {
  if (!rollbackVersions.includes(version))
    throw Error(
      "该 Worker 版本不在已验证的回滚范围（" +
        rollbackVersions.join(" / ") +
        "）；未改动代码或数据库。v1.0.0 不接受当前 Agent 的上报格式。",
    );
  if (version === "1.0.1" && columns.includes("short_mark"))
    throw Error(
      "数据库仍处于升级过渡状态；请先完成正常部署，再回滚到 v1.0.1。",
    );
}
export function currentWorkerVersion(deployments) {
  const latest = [...deployments]
    .sort((a, b) => a.created_on.localeCompare(b.created_on))
    .at(-1);
  if (latest?.versions?.length !== 1 || latest.versions[0].percentage !== 100)
    throw Error("仅支持单一版本承接全部流量的部署；未执行回滚。");
  return latest.versions[0].version_id;
}

/** Success requires both readable dashboard data and reports generated after
 * switching code. Old buffered reports cannot satisfy this check. */
export async function waitForLiveReports({
  read,
  targets,
  version,
  since,
  timeoutMs = 1_230_000,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  progress = () => {},
}) {
  const deadline = now() + timeoutMs;
  let missing = targets.map((node) => node.node_id);
  let nextProgress = 0;
  while (now() < deadline) {
    try {
      const { health, dashboard, inventory } = await read();
      if (
        health.ok &&
        health.version === version &&
        dashboard.app_version === version &&
        Array.isArray(dashboard.nodes) &&
        Array.isArray(inventory.nodes)
      ) {
        missing = targets
          .filter((target) => {
            const report = inventory.nodes.find(
              (node) => node.node_id === target.node_id,
            );
            const card = dashboard.nodes.find(
              (node) => node.id === target.public_id,
            );
            return (
              !report?.enabled ||
              report.retired ||
              !(report.last_report_at > since) ||
              !(
                report.generated_at > Math.max(since, target.generated_at ?? 0)
              ) ||
              !card?.online ||
              card.data_error ||
              !(card.reported_at >= report.generated_at)
            );
          })
          .map((node) => node.node_id);
        if (!missing.length) return;
      }
    } catch {
      /* Transient propagation or network errors must never count as success. */
    }
    if (now() >= nextProgress) {
      progress(
        missing.length
          ? "等待回滚后的新上报：" + missing.join("、")
          : "等待回滚版本与面板读取验证…",
      );
      nextProgress = now() + 30_000;
    }
    await sleep(5_000);
  }
  throw Error(
    "回滚后的版本、面板或新上报未通过验证" +
      (missing.length ? "：" + missing.join("、") : ""),
  );
}

export async function rollbackSafely({
  rollback,
  verify,
  restore,
  verifyRestored,
}) {
  try {
    await rollback();
    await verify();
  } catch (failure) {
    try {
      await restore();
      await verifyRestored();
    } catch (recovery) {
      throw Error(
        "回滚失败，原版本恢复也未通过验证；请检查 Worker 部署与节点状态。",
        { cause: recovery },
      );
    }
    throw Error("回滚未通过验证，已恢复原 Worker 并确认面板与节点上报。", {
      cause: failure,
    });
  }
}
