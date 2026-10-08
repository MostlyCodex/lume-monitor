<script setup lang="ts">
import { computed, watch } from "vue";
import { createDashboardApi } from "./services/dashboardApi";
import { DEMO_MODE } from "./runtime";
import { useDashboard } from "./composables/useDashboard";
import { usePreferences } from "./composables/usePreferences";
import { useTheme } from "./composables/useTheme";
import { useToast } from "./composables/useToast";
import { displayNodes } from "./domain/nodes";
import { overview } from "./domain/overview";
import LoadingView from "./components/LoadingView.vue";
import AuthView from "./components/AuthView.vue";
import DashboardHeader from "./components/DashboardHeader.vue";
import FleetView from "./components/FleetView.vue";
import NodeDetail from "./components/NodeDetail.vue";

const { toast, notify } = useToast();
const { layout, save, pruneNodes } = usePreferences();
const { theme, toggleTheme } = useTheme();
const {
  latest,
  fleetHistory,
  detailHistory,
  view,
  selectedId,
  hours,
  refreshing,
  detailLoading,
  detailError,
  openNode,
  closeNode,
  setHours,
  refresh,
  logout,
} = useDashboard(createDashboardApi(DEMO_MODE), notify);

watch(
  () => latest.value?.catalog.known_node_ids,
  (ids) => {
    if (Array.isArray(ids)) pruneNodes(ids);
  },
);

const nodes = computed(() => displayNodes(latest.value, layout.value));
const selected = computed(() => nodes.value.find((node) => node.id === selectedId.value));
const health = computed(() => overview(nodes.value, fleetHistory.value));

function reorder(order: string[]) {
  if (!save({ order })) notify("排序已调整，但浏览器存储不可用，刷新后将恢复默认顺序。", true);
}
</script>

<template>
  <div class="min-h-screen bg-background font-sans text-foreground antialiased">
    <!-- 视图路由 -->
    <LoadingView v-if="view === 'loading'" />
    <AuthView v-else-if="view === 'auth'" @notify="notify" />

    <div v-else id="dashboard-view" class="flex min-h-screen flex-col">
      <DashboardHeader
        :health="health"
        :refreshed-at="latest?.server_time"
        :refreshing="refreshing"
        :demo="DEMO_MODE"
        @refresh="refresh"
        @theme="toggleTheme"
        @logout="logout"
      />

      <main class="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <!-- 演示模式提示栏 -->
        <aside
          v-if="DEMO_MODE"
          id="demo-notice"
          class="flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground"
          aria-label="演示说明"
        >
          <span>公开演示环境（虚构数据），可随意点击节点体验链路图表与控制面板。</span>
          <a
            class="shrink-0 font-medium text-foreground underline-offset-4 hover:underline"
            href="https://github.com/MostlyCodex/lume-monitor/blob/main/docs/guide.md"
            target="_blank"
            rel="noreferrer"
          >
            部署自己的 Lume →
          </a>
        </aside>

        <!-- 节点列表试图 -->
        <FleetView
          v-show="!selected"
          :nodes="nodes"
          :history="fleetHistory"
          :now="latest?.server_time ?? 0"
          @open="openNode"
          @reorder="reorder"
        />

        <!-- 节点详情试图 -->
        <NodeDetail
          v-if="selected"
          :node="selected"
          :history="detailHistory"
          :fleet-history="fleetHistory"
          :hours="hours"
          :theme="theme"
          :loading="detailLoading"
          :error="detailError"
          @back="closeNode"
          @range="setHours"
        />
      </main>

      <footer class="mt-2 h-6 border-t" aria-hidden="true"></footer>
    </div>

    <!-- 全局 Floating Toast 提示 -->
    <div
      v-if="toast.message"
      id="toast"
      class="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-lg border bg-popover px-4 py-3 text-sm shadow-lg"
      :class="toast.error ? 'text-destructive' : 'text-popover-foreground'"
      role="status"
      aria-live="polite"
    >
      <span>{{ toast.message }}</span>
    </div>
  </div>
</template>
