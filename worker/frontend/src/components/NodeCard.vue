<script setup lang="ts">
import { computed } from "vue";
import type { HistorySnapshot, NodeSnapshot } from "../types";
import { allProbes, nodeSeverity, severityLabel } from "../domain/probes";
import { formatRate, formatUptime } from "../domain/format";
import { trafficSummary } from "../domain/traffic";
import ResourceGauge from "./ResourceGauge.vue";
import ProbeRow from "./ProbeRow.vue";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";

const props = defineProps<{ node: NodeSnapshot; history: HistorySnapshot | null; now: number }>();
const emit = defineEmits<{ open: [id: string] }>();

const severity = computed(() => nodeSeverity(props.node, props.history));
const probes = computed(() =>
  allProbes(props.node)
    .filter((probe) => probe.kind === "icmp")
    .slice(0, 4),
);
const traffic = computed(() => trafficSummary(props.node.metrics));

const badgeVariant = computed(() => {
  if (severity.value === "healthy") return "healthy";
  if (severity.value === "warning") return "degraded";
  if (severity.value === "critical" || severity.value === "offline") return "critical";
  return "stale";
});
</script>

<template>
  <Card
    class="node-card group cursor-grab gap-0 overflow-hidden py-0 transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:gap-0 sm:py-0"
    :data-node="node.id"
    role="button"
    tabindex="0"
    :aria-label="`查看 ${node.label} 详情`"
    @click="emit('open', node.id)"
    @keydown.enter.prevent="emit('open', node.id)"
    @keydown.space.prevent="emit('open', node.id)"
  >
    <!-- 标题、资源、流量、网络质量四部分以细分割线隔开 -->
    <div
      class="flex flex-1 flex-col divide-y px-4 sm:px-5 [&>section]:py-3 [&>section:first-child]:pt-4 [&>section:last-child]:pb-4 sm:[&>section:first-child]:pt-5 sm:[&>section:last-child]:pb-5"
    >
      <!-- 卡片头部 -->
      <section>
        <!-- 左侧名称；右侧状态徽章与运行时长（较小字号） -->
        <div class="flex items-center justify-between gap-3">
          <span class="node-title min-w-0 truncate text-base font-semibold leading-none">
            {{ node.label }}
          </span>
          <div class="flex shrink-0 flex-col items-end gap-1.5">
            <Badge :variant="badgeVariant">
              {{ node.data_error ? "等待上报" : severityLabel(severity) }}
            </Badge>
            <span class="text-xs tabular-nums text-muted-foreground">
              {{
                node.data_error
                  ? "等待首次上报"
                  : `运行 ${formatUptime(node.metrics.uptime_seconds)}`
              }}
            </span>
          </div>
        </div>
      </section>

      <section v-if="node.data_error" class="text-center text-sm text-muted-foreground">
        <p class="font-medium text-foreground">暂无有效数据</p>
        <p class="mt-1">Agent 完成首次上报后自动显示</p>
      </section>

      <template v-else>
        <!-- 资源利用率 -->
        <section>
          <div class="grid grid-cols-3 gap-3 sm:gap-4">
            <ResourceGauge short-label="CPU" label="处理器" :value="node.metrics.cpu_percent" />
            <ResourceGauge
              short-label="RAM"
              label="内存"
              :value="node.metrics.memory_used_percent"
            />
            <ResourceGauge
              short-label="Disk"
              label="磁盘"
              :value="node.metrics.disk_used_percent"
              :warning="75"
            />
          </div>
        </section>

        <!-- 实时与周期网络流量 -->
        <section>
          <div class="flex flex-col gap-1.5 text-sm">
            <div class="node-network-row flex items-center justify-between gap-3">
              <span>实时速率</span>
              <span class="flex items-center gap-2 font-medium tabular-nums">
                <span>↑ {{ formatRate(node.metrics.network_tx_rate_bps) }}</span>
                <span>↓ {{ formatRate(node.metrics.network_rx_rate_bps) }}</span>
              </span>
            </div>
            <div
              class="node-network-row flex items-center justify-between gap-3"
              :title="traffic.description"
            >
              <span>{{ traffic.label }}</span>
              <span class="flex items-center gap-2 font-medium tabular-nums">
                <span>↑ {{ traffic.tx }}</span>
                <span>↓ {{ traffic.rx }}</span>
              </span>
            </div>
          </div>
        </section>

        <!-- 网络质量 -->
        <section v-if="probes.length">
          <div class="flex flex-col gap-2.5">
            <ProbeRow
              v-for="probe in probes"
              :key="probe.name"
              :node="node"
              :probe="probe"
              :history="history"
              :now="now"
            />
          </div>
        </section>
        <section v-else class="text-center text-sm text-muted-foreground">
          此节点仅监测服务与基础资源
        </section>
      </template>
    </div>
  </Card>
</template>
