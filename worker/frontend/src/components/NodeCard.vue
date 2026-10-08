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
    class="node-card group relative flex cursor-grab flex-col overflow-hidden border-border/80 bg-card transition-[border-color,box-shadow] duration-200 hover:border-border hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    :data-node="node.id"
    role="button"
    tabindex="0"
    :aria-label="`查看 ${node.label} 详情`"
    @click="emit('open', node.id)"
    @keydown.enter.prevent="emit('open', node.id)"
    @keydown.space.prevent="emit('open', node.id)"
  >
    <!-- 标题、资源、流量、网络质量四部分以细分割线隔开 -->
    <div class="flex flex-1 flex-col divide-y divide-border/70 px-5">
      <!-- 卡片头部 -->
      <section class="py-4 first:pt-5 last:pb-5">
        <div class="flex items-start justify-between gap-3">
          <div class="flex items-center gap-3 min-w-0">
            <div class="min-w-0 flex flex-col">
              <span
                class="node-title truncate font-semibold text-base leading-tight text-foreground group-hover:text-primary transition-colors"
              >
                {{ node.label }}
              </span>
              <span class="text-xs text-muted-foreground font-mono mt-0.5">
                {{
                  node.data_error
                    ? "等待首次上报"
                    : `运行 ${formatUptime(node.metrics.uptime_seconds)}`
                }}
              </span>
            </div>
          </div>

          <Badge :variant="badgeVariant" class="shrink-0 font-normal text-xs py-0.5 px-2">
            <span class="relative flex h-1.5 w-1.5 mr-1">
              <span
                v-if="badgeVariant === 'healthy'"
                class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"
              ></span>
              <span
                class="relative inline-flex rounded-full h-1.5 w-1.5"
                :class="{
                  'bg-emerald-500': badgeVariant === 'healthy',
                  'bg-amber-500': badgeVariant === 'degraded',
                  'bg-rose-500': badgeVariant === 'critical',
                  'bg-zinc-400': badgeVariant === 'stale',
                }"
              ></span>
            </span>
            {{ node.data_error ? "等待上报" : severityLabel(severity) }}
          </Badge>
        </div>
      </section>

      <section v-if="node.data_error" class="py-8 text-center text-sm text-muted-foreground">
        <p class="font-medium text-foreground">暂无有效数据</p>
        <p class="text-xs mt-1">Agent 完成首次上报后自动显示</p>
      </section>

      <template v-else>
        <!-- 资源利用率 -->
        <section class="py-4 last:pb-5">
          <div class="grid grid-cols-3 gap-4">
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
        <section class="py-4 last:pb-5">
          <div class="flex flex-col gap-1.5 text-xs">
            <div class="node-network-row flex items-center justify-between py-0.5">
              <span class="text-muted-foreground font-medium">实时速率</span>
              <span class="font-mono text-xs tabular-nums text-foreground flex items-center gap-2">
                <span class="text-emerald-500"
                  >↑ {{ formatRate(node.metrics.network_tx_rate_bps) }}</span
                >
                <span class="text-sky-500"
                  >↓ {{ formatRate(node.metrics.network_rx_rate_bps) }}</span
                >
              </span>
            </div>

            <div
              class="node-network-row flex items-center justify-between py-0.5"
              :title="traffic.description"
            >
              <span class="text-muted-foreground font-medium">{{ traffic.label }}</span>
              <span
                class="font-mono text-xs tabular-nums text-muted-foreground flex items-center gap-2"
              >
                <span>↑ {{ traffic.tx }}</span>
                <span>↓ {{ traffic.rx }}</span>
              </span>
            </div>
          </div>
        </section>

        <!-- 网络质量 -->
        <section v-if="probes.length" class="space-y-1.5 py-4 last:pb-5">
          <div class="text-xs font-medium text-muted-foreground">网络质量</div>
          <div>
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
        <section v-else class="py-4 text-center text-xs text-muted-foreground last:pb-5">
          此节点仅监测服务与基础资源
        </section>
      </template>
    </div>
  </Card>
</template>
