<script setup lang="ts">
import AppIcon from "./AppIcon.vue";
import BrandLockup from "./BrandLockup.vue";
import { formatTime } from "../domain/format";
import type { Overview } from "../domain/overview";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

const props = defineProps<{
  health: Overview;
  refreshedAt?: number;
  refreshing: boolean;
  demo: boolean;
}>();

const emit = defineEmits<{ refresh: []; theme: []; logout: [] }>();

function mapHealthTone(tone: string): "healthy" | "degraded" | "critical" | "stale" {
  if (tone === "good" || tone === "healthy") return "healthy";
  if (tone === "warn" || tone === "warning" || tone === "degraded") return "degraded";
  if (tone === "bad" || tone === "critical" || tone === "offline") return "critical";
  return "stale";
}
</script>

<template>
  <header class="sticky top-0 z-40 w-full border-b bg-background">
    <div class="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
      <!-- 品牌标识 -->
      <BrandLockup
        class="shrink-0"
        brand="Lume"
        :tagline="demo ? '公开演示 · 虚构数据' : 'SECURE OBSERVABILITY'"
      />

      <!-- 集群健康概览 Badge -->
      <div id="top-health" class="hidden sm:flex items-center">
        <Badge :variant="mapHealthTone(health.tone)" class="py-1 px-3 gap-2 text-xs font-normal">
          <span class="relative flex h-2 w-2">
            <span
              v-if="mapHealthTone(health.tone) === 'healthy'"
              class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"
            ></span>
            <span
              class="relative inline-flex rounded-full h-2 w-2"
              :class="{
                'bg-emerald-500': mapHealthTone(health.tone) === 'healthy',
                'bg-amber-500': mapHealthTone(health.tone) === 'degraded',
                'bg-rose-500': mapHealthTone(health.tone) === 'critical',
                'bg-zinc-500': mapHealthTone(health.tone) === 'stale',
              }"
            ></span>
          </span>
          <span class="font-semibold">{{ health.title }}</span>
          <span id="fleet-health-copy" class="text-muted-foreground opacity-90 font-mono">{{
            health.detail
          }}</span>
        </Badge>
      </div>

      <!-- 右侧控制区 -->
      <div class="flex items-center gap-2 sm:gap-3">
        <span
          id="last-refresh"
          class="hidden md:inline-block text-xs font-mono text-muted-foreground mr-1"
        >
          {{ refreshedAt ? `${formatTime(refreshedAt)} 更新` : "尚未刷新" }}
        </span>

        <Button
          id="refresh-button"
          variant="outline"
          size="icon"
          class="h-8 w-8 rounded-md coarse:h-11 coarse:w-11"
          :disabled="refreshing"
          aria-label="立即刷新"
          title="立即刷新"
          @click="emit('refresh')"
        >
          <AppIcon name="refresh" :class="{ 'animate-spin': refreshing }" />
        </Button>

        <Button
          id="theme-button"
          variant="outline"
          size="icon"
          class="h-8 w-8 rounded-md coarse:h-11 coarse:w-11"
          type="button"
          aria-label="切换深浅色主题"
          title="切换主题"
          @click="emit('theme')"
        >
          <AppIcon name="theme" />
        </Button>

        <a
          v-if="demo"
          class="inline-flex items-center justify-center h-8 coarse:h-11 px-3 text-xs font-medium rounded-md border border-border bg-secondary hover:bg-secondary/80 text-secondary-foreground transition-colors"
          href="https://github.com/MostlyCodex/lume-monitor"
          target="_blank"
          rel="noreferrer"
        >
          GitHub
        </a>

        <Button
          v-if="!demo"
          id="logout-button"
          variant="ghost"
          size="sm"
          class="h-8 px-3 text-xs text-muted-foreground hover:text-foreground"
          type="button"
          @click="emit('logout')"
        >
          退出
        </Button>
      </div>
    </div>
  </header>
</template>
