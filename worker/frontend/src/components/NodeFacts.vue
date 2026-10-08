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
  <Card>
    <CardHeader>
      <CardTitle>节点规格</CardTitle>
    </CardHeader>
    <CardContent>
      <dl id="detail-facts" class="grid grid-cols-2 gap-x-4 gap-y-4 lg:grid-cols-3">
        <div
          v-for="fact in facts"
          :key="fact.label"
          class="detail-fact flex min-w-0 flex-col gap-1"
          :class="{
            'col-span-2 lg:col-span-3': fact.label === '流量周期',
          }"
        >
          <dt class="text-sm text-muted-foreground">{{ fact.label }}</dt>
          <dd class="break-all text-sm font-medium tabular-nums">{{ fact.value }}</dd>
        </div>
      </dl>
    </CardContent>
  </Card>
</template>
