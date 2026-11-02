<script setup lang="ts">
import { computed } from "vue";
import type { NodeSnapshot } from "../types";
import { formatCapacity } from "../domain/format";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";

const props = defineProps<{ node: NodeSnapshot }>();

const facts = computed(() => {
  const { metrics, system } = props.node;
  return [
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
});
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>节点规格</CardTitle>
    </CardHeader>
    <CardContent>
      <dl id="detail-facts" class="flex flex-col gap-2.5 text-sm">
        <div
          v-for="fact in facts"
          :key="fact.label"
          class="detail-fact grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] gap-4"
        >
          <dt class="text-muted-foreground">{{ fact.label }}</dt>
          <dd class="break-all font-medium">{{ fact.value }}</dd>
        </div>
      </dl>
    </CardContent>
  </Card>
</template>
