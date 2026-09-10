<script setup lang="ts">
import AppIcon from "./AppIcon.vue";
import { formatTime } from "../domain/format";
import type { Overview } from "../domain/overview";
defineProps<{
  brand: string;
  health: Overview;
  refreshedAt?: number;
  refreshing: boolean;
  demo: boolean;
}>();
const emit = defineEmits<{ refresh: []; theme: []; settings: []; logout: [] }>();
</script>
<template>
  <header class="command-bar glass-panel">
    <div class="brand-lockup app-brand">
      <div>
        <strong data-dashboard-brand>{{ brand }}</strong
        ><span>{{ demo ? "公开演示 · 虚构数据" : "SECURE OBSERVABILITY" }}</span>
      </div>
    </div>
    <div id="top-health" class="fleet-health" :class="`is-${health.tone}`">
      <i></i>
      <div>
        <strong>{{ health.title }}</strong
        ><span id="fleet-health-copy">{{ health.detail }}</span>
      </div>
    </div>
    <div class="command-actions">
      <span id="last-refresh" class="last-refresh">{{
        refreshedAt ? `${formatTime(refreshedAt)} 更新` : "尚未刷新"
      }}</span>
      <button
        id="refresh-button"
        class="icon-button"
        :class="{ 'is-spinning': refreshing }"
        type="button"
        :disabled="refreshing"
        aria-label="立即刷新"
        title="立即刷新"
        @click="emit('refresh')"
      >
        <AppIcon name="refresh" />
      </button>
      <button
        id="theme-button"
        class="icon-button"
        type="button"
        aria-label="切换深浅色主题"
        title="切换主题"
        @click="emit('theme')"
      >
        <AppIcon name="theme" />
      </button>
      <button
        id="settings-button"
        class="icon-button"
        type="button"
        aria-label="编辑面板显示"
        title="编辑面板显示"
        @click="emit('settings')"
      >
        <AppIcon name="settings" />
      </button>
      <a v-if="demo" class="text-button" href="https://github.com/MostlyCodex/lume-monitor"
        >GitHub</a
      >
      <button
        id="logout-button"
        class="text-button"
        type="button"
        :hidden="demo"
        @click="emit('logout')"
      >
        退出
      </button>
    </div>
  </header>
</template>
