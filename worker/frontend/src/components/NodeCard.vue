<script setup lang="ts">
import { computed } from "vue";
import type { HistorySnapshot, NodeSnapshot } from "../types";
import { allProbes, withoutRegionSuffix } from "../domain/probes";
import { nodeRegion } from "../domain/nodes";
import { formatRate, formatUptime } from "../domain/format";
import { trafficSummary } from "../domain/traffic";
import ResourceGauge from "./ResourceGauge.vue";
import ProbeRow from "./ProbeRow.vue";
import { Card } from "./ui/card";

const props = defineProps<{ node: NodeSnapshot; history: HistorySnapshot | null; now: number }>();
const emit = defineEmits<{ open: [id: string] }>();

// 首页展示全部探测（三网参考、公网网址、节点互联），互联链路排在最后
const probes = computed(() => allProbes(props.node));
const traffic = computed(() => trafficSummary(props.node.metrics));
const online = computed(() => props.node.online && !props.node.data_error);
const region = computed(() => nodeRegion(props.node));
</script>

<template>
  <Card
    class="node-card group cursor-grab gap-0 px-5 py-0 transition-colors hover:bg-[var(--glass-hover)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:gap-0 sm:py-0"
    :data-node="node.id"
    role="button"
    tabindex="0"
    :aria-label="`查看 ${node.label} 详情`"
    @click="emit('open', node.id)"
    @keydown.enter.prevent="emit('open', node.id)"
    @keydown.space.prevent="emit('open', node.id)"
  >
    <!-- 单行：名称 | 地区，右侧在线圆点与运行时长 -->
    <header class="flex items-center gap-3 pt-5">
      <div class="flex min-w-0 flex-1 items-center gap-2.5">
        <span class="node-title min-w-0 truncate text-[17px] font-semibold leading-tight">
          {{ withoutRegionSuffix(node.label) }}
        </span>
        <template v-if="region">
          <span class="h-3.5 w-px shrink-0 bg-border" aria-hidden="true"></span>
          <span class="shrink-0 text-[13px] text-muted-foreground">{{ region }}</span>
        </template>
      </div>
      <span class="inline-flex shrink-0 items-center gap-2 text-[13px] text-muted-foreground">
        <span
          class="size-[7px] rounded-full"
          :class="online ? 'bg-brand' : 'bg-muted-foreground/50'"
          aria-hidden="true"
        ></span>
        <span class="node-status" :data-online="online">
          {{ online ? `在线 ${formatUptime(node.metrics.uptime_seconds)}` : "下线" }}
        </span>
      </span>
    </header>

    <div
      v-if="node.data_error"
      class="flex flex-1 flex-col justify-center py-8 text-center text-sm"
    >
      <p class="font-medium">暂无有效数据</p>
      <p class="mt-1 text-muted-foreground">Agent 完成首次上报后自动显示</p>
    </div>

    <template v-else>
      <!-- 线路：每行固定高度、等间距 -->
      <section
        v-if="probes.length"
        class="my-5 grid grid-cols-[fit-content(4.5rem)_minmax(0,1fr)_auto_auto] gap-x-3 gap-y-3.5"
      >
        <ProbeRow
          v-for="probe in probes"
          :key="probe.name"
          :node="node"
          :probe="probe"
          :history="history"
          :now="now"
        />
      </section>
      <p v-else class="my-5 text-sm text-muted-foreground">此节点仅监测服务与基础资源</p>

      <!-- 资源与流量：次要信息收在底部 -->
      <footer class="mt-auto grid grid-cols-3 gap-x-4 gap-y-1.5 border-t pb-4 pt-3.5">
        <ResourceGauge short-label="CPU" label="处理器" :value="node.metrics.cpu_percent" />
        <ResourceGauge short-label="内存" label="内存" :value="node.metrics.memory_used_percent" />
        <ResourceGauge
          short-label="磁盘"
          label="磁盘"
          :value="node.metrics.disk_used_percent"
          :warning="75"
        />
        <!-- 速率与流量沿用上面三列：名称对齐 CPU，↑ 对齐内存，↓ 对齐磁盘 -->
        <div
          class="node-network-row col-span-3 mt-1.5 grid grid-cols-subgrid text-[12.5px] leading-tight"
        >
          <span class="text-muted-foreground">实时速率</span>
          <span class="font-medium tabular-nums"
            >↑ {{ formatRate(node.metrics.network_tx_rate_bps) }}</span
          >
          <span class="font-medium tabular-nums"
            >↓ {{ formatRate(node.metrics.network_rx_rate_bps) }}</span
          >
        </div>
        <div class="node-network-row col-span-3 grid grid-cols-subgrid text-[12.5px] leading-tight">
          <span class="text-muted-foreground">{{ traffic.label }}</span>
          <span class="font-medium tabular-nums">↑ {{ traffic.tx }}</span>
          <span class="font-medium tabular-nums">↓ {{ traffic.rx }}</span>
        </div>
      </footer>
    </template>
  </Card>
</template>
