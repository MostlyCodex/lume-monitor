<script setup lang="ts">
import { computed } from "vue";
import type { NodeSnapshot } from "../types";
import { formatCapacity } from "../domain/format";
import { cycleDescription } from "../domain/traffic";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";

const props = defineProps<{ node: NodeSnapshot }>();

const facts = computed(() => {
  const { metrics, system, agent } = props.node;
  const values = [
    { label: "操作系统", value: system?.os || "—" },
    { label: "系统内核", value: system?.kernel || "—" },
    {
      label: "CPU 规格",
      value:
        Number.isInteger(metrics.cpu_count) && Number(metrics.cpu_count) > 0
          ? `${metrics.cpu_count} vCPU`
          : "—",
    },
    { label: "总内存", value: formatCapacity(metrics.memory_total_bytes) },
    { label: "总磁盘", value: formatCapacity(metrics.disk_total_bytes) },
    { label: "主机名称", value: system?.hostname || "—" },
    { label: "Agent 版本", value: `${agent?.version || "—"} (队列: ${agent?.queue_depth ?? 0})` },
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
  <Card class="border-border/80 bg-card">
    <CardHeader class="p-5 pb-3">
      <span class="text-[11px] font-mono text-muted-foreground uppercase tracking-wider block"
        >NODE FACTS</span
      >
      <CardTitle class="text-base font-semibold mt-0.5">节点规格与详情</CardTitle>
    </CardHeader>
    <CardContent class="p-5 pt-2">
      <dl id="detail-facts" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div
          v-for="fact in facts"
          :key="fact.label"
          class="detail-fact flex min-w-0 flex-col gap-1 rounded-lg border border-border/50 bg-muted/20 p-3"
          :class="{
            'sm:col-span-2 lg:col-span-3': fact.label === '流量周期' || fact.label === '统计网卡',
          }"
        >
          <dt class="text-[11px] font-medium text-muted-foreground">{{ fact.label }}</dt>
          <dd class="text-xs font-semibold text-foreground font-mono break-all">
            {{ fact.value }}
          </dd>
        </div>
      </dl>
    </CardContent>
  </Card>
</template>
