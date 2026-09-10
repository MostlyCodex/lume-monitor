<script setup lang="ts">
import { computed } from "vue";
import type { HistorySnapshot, NodeSnapshot } from "../types";
import { allProbes, nodeSeverity, severityLabel } from "../domain/probes";
import { formatAge, formatRate, formatUptime } from "../domain/format";
import { trafficSummary } from "../domain/traffic";
import CountryFlag from "./CountryFlag.vue";
import ResourceGauge from "./ResourceGauge.vue";
import ProbeRow from "./ProbeRow.vue";
const props = defineProps<{ node: NodeSnapshot; history: HistorySnapshot | null; now: number }>();
const emit = defineEmits<{ open: [id: string] }>();
const severity = computed(() => nodeSeverity(props.node, props.history));
const probes = computed(() =>
  allProbes(props.node)
    .filter((probe) => probe.kind === "icmp")
    .slice(0, 4),
);
const traffic = computed(() => trafficSummary(props.node.metrics));
</script>
<template>
  <article
    class="node-card"
    :class="`is-${severity}`"
    :data-node="node.id"
    role="button"
    tabindex="0"
    :aria-label="`查看 ${node.label} 详情`"
    @click="emit('open', node.id)"
    @keydown.enter.prevent="emit('open', node.id)"
    @keydown.space.prevent="emit('open', node.id)"
  >
    <div class="node-card-inner">
      <div class="node-card-head">
        <div class="node-flag" role="img" :aria-label="node.country || '未知国家'">
          <CountryFlag :country="node.country" />
        </div>
        <div class="node-title">
          <strong>{{ node.label }}</strong
          ><span class="node-uptime">{{
            node.data_error ? "等待首次上报" : `运行 ${formatUptime(node.metrics.uptime_seconds)}`
          }}</span>
        </div>
        <span class="node-status" :class="`is-${severity}`"
          ><i class="node-live-dot"></i
          >{{ node.data_error ? "等待上报" : severityLabel(severity) }}</span
        >
      </div>
      <div v-if="node.data_error" class="node-card-placeholder">
        <div>
          <strong>暂无有效数据</strong>
          <p>Agent 完成首次上报后自动显示</p>
        </div>
      </div>
      <template v-else>
        <div class="resource-gauges">
          <ResourceGauge short-label="CPU" label="处理器" :value="node.metrics.cpu_percent" />
          <ResourceGauge short-label="RAM" label="内存" :value="node.metrics.memory_used_percent" />
          <ResourceGauge
            short-label="Disk"
            label="磁盘"
            :value="node.metrics.disk_used_percent"
            :warning="75"
          />
        </div>
        <div class="node-network">
          <div class="node-network-row">
            <span>↯ 网络速率</span
            ><strong
              ><b class="is-up">↑ {{ formatRate(node.metrics.network_tx_rate_bps) }}</b
              ><b class="is-down">↓ {{ formatRate(node.metrics.network_rx_rate_bps) }}</b></strong
            >
          </div>
          <div class="node-network-row" :title="traffic.description">
            <span>{{ traffic.label }}</span
            ><strong
              ><b>↑ {{ traffic.tx }}</b
              ><b>↓ {{ traffic.rx }}</b></strong
            >
          </div>
        </div>
        <div v-if="probes.length" class="probe-block">
          <div class="probe-block-head">
            <span>网络质量（24H）</span><small>{{ probes.length }} 个目标</small>
          </div>
          <ProbeRow
            v-for="probe in probes"
            :key="probe.name"
            :node="node"
            :probe="probe"
            :history="history"
            :now="now"
          />
        </div>
        <div v-else class="probe-empty">此节点仅监测服务与基础资源</div>
      </template>
      <div class="node-card-foot">
        <div class="node-tags">
          <span>{{ node.role || "VPS" }}</span
          ><span>{{ [node.country, node.region].filter(Boolean).join(" · ") || "未知区域" }}</span>
        </div>
        <span>{{ node.data_error ? "查看详情" : `${formatAge(node.age_seconds)}更新` }} →</span>
      </div>
    </div>
  </article>
</template>
