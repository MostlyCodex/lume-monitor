<script setup lang="ts">
import { computed } from "vue";
import type { NodeSnapshot } from "../types";
import { formatCapacity } from "../domain/format";
import { cycleDescription } from "../domain/traffic";
const props = defineProps<{ node: NodeSnapshot }>();
const facts = computed(() => {
  const { metrics, system, agent } = props.node;
  const values = [
    { label: "系统", value: system?.os || "—" },
    { label: "内核", value: system?.kernel || "—" },
    {
      label: "CPU",
      value:
        Number.isInteger(metrics.cpu_count) && Number(metrics.cpu_count) > 0
          ? `${metrics.cpu_count} vCPU`
          : "—",
    },
    { label: "内存", value: formatCapacity(metrics.memory_total_bytes) },
    { label: "磁盘（/）", value: formatCapacity(metrics.disk_total_bytes) },
    { label: "主机名", value: system?.hostname || "—" },
    { label: "Agent", value: `${agent?.version || "—"} · 队列 ${agent?.queue_depth ?? 0}` },
    {
      label: "采集/发送错误",
      value: String((agent?.collect_errors ?? 0) + (agent?.send_errors ?? 0)),
    },
    {
      label: "统计网卡",
      value: metrics.network_interfaces?.length
        ? `${metrics.network_interfaces.join("、")}${metrics.network_valid === false ? "（采集异常）" : ""}`
        : metrics.network_valid === false
          ? "无法识别，请配置网卡"
          : "未上报",
    },
  ];
  return metrics.traffic_cycle_enabled || metrics.traffic_cycle
    ? [...values, { label: "流量周期", value: cycleDescription(metrics.traffic_cycle) }]
    : values;
});
</script>
<template>
  <section class="detail-section" aria-labelledby="detail-facts-title">
    <div class="section-heading">
      <div>
        <p class="eyebrow">NODE FACTS</p>
        <h2 id="detail-facts-title">节点信息</h2>
      </div>
    </div>
    <article class="info-card glass-panel">
      <dl id="detail-facts" class="detail-facts">
        <div
          v-for="fact in facts"
          :key="fact.label"
          class="detail-fact"
          :class="{ 'detail-fact-wide': fact.label === '流量周期' }"
        >
          <dt>{{ fact.label }}</dt>
          <dd>{{ fact.value }}</dd>
        </div>
      </dl>
    </article>
  </section>
</template>
