<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { createDashboardApi } from "./services/dashboardApi";
import { DEMO_MODE } from "./runtime";
import { useDashboard } from "./composables/useDashboard";
import { usePreferences } from "./composables/usePreferences";
import { useTheme } from "./composables/useTheme";
import { useToast } from "./composables/useToast";
import { useSceneViewport } from "./composables/useSceneViewport";
import { displayNodes } from "./domain/nodes";
import { overview } from "./domain/overview";
import BackgroundImage from "./components/BackgroundImage.vue";
import LoadingView from "./components/LoadingView.vue";
import AuthView from "./components/AuthView.vue";
import DashboardHeader from "./components/DashboardHeader.vue";
import FleetView from "./components/FleetView.vue";
import NodeDetail from "./components/NodeDetail.vue";
import SettingsDialog from "./components/SettingsDialog.vue";

const { toast, notify } = useToast();
const { layout, save, reset, pruneNodes, discardUnreadableBackground } = usePreferences();
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
const scene = ref<HTMLElement | null>(null);
useSceneViewport(scene);
const settingsOpen = ref(false),
  preview = ref<string | null>(null);
const nodes = computed(() => displayNodes(latest.value, layout.value));
const selected = computed(() => nodes.value.find((node) => node.id === selectedId.value));
const health = computed(() => overview(nodes.value, fleetHistory.value, latest.value));
function backgroundFailed(value: string) {
  discardUnreadableBackground(value);
  if (preview.value !== null) preview.value = "";
  notify("背景图片无法读取，已显示默认背景，请重新选择图片。", true);
}
</script>
<template>
  <div ref="scene" class="scene" aria-hidden="true">
    <BackgroundImage
      class="scene-image"
      :background="preview ?? layout.background"
      width="8000"
      height="5000"
      fetchpriority="high"
      :draggable="false"
      @unreadable="backgroundFailed"
    />
    <span class="scene-glow scene-glow-one"></span><span class="scene-glow scene-glow-two"></span
    ><span class="scene-grid"></span>
  </div>
  <LoadingView v-if="view === 'loading'" />
  <AuthView v-else-if="view === 'auth'" :brand="layout.brand" @notify="notify" />
  <div v-else id="dashboard-view" class="app-shell">
    <DashboardHeader
      :brand="layout.brand"
      :health="health"
      :refreshed-at="latest?.server_time"
      :refreshing="refreshing"
      :demo="DEMO_MODE"
      @refresh="refresh"
      @theme="toggleTheme"
      @settings="settingsOpen = true"
      @logout="logout"
    />
    <main class="page-shell">
      <aside v-if="DEMO_MODE" class="demo-notice" aria-label="演示说明">
        <span>虚构数据，可点击节点体验历史图表和面板设置。</span
        ><a href="https://github.com/MostlyCodex/lume-monitor/blob/main/docs/guide.md"
          >部署自己的 Lume →</a
        >
      </aside>
      <FleetView
        v-show="!selected"
        :nodes="nodes"
        :history="fleetHistory"
        :health="health"
        :now="latest?.server_time ?? 0"
        @open="openNode"
      />
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
    <footer class="dashboard-footer" aria-hidden="true"></footer>
    <SettingsDialog
      :open="settingsOpen"
      :layout="layout"
      :nodes="nodes"
      :persist="save"
      :reset-preferences="reset"
      @close="settingsOpen = false"
      @preview="preview = $event"
      @notify="notify"
    />
  </div>
  <div
    id="toast"
    class="toast"
    :class="{ 'is-hidden': !toast.message, 'is-error': toast.error }"
    role="status"
    aria-live="polite"
  >
    {{ toast.message }}
  </div>
</template>
