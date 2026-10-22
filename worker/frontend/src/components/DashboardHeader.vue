<script setup lang="ts">
import AppIcon from "./AppIcon.vue";
import BrandLockup from "./BrandLockup.vue";
import { formatTime } from "../domain/format";
import { Button } from "./ui/button";

const props = defineProps<{
  refreshedAt?: number;
  refreshing: boolean;
  demo: boolean;
}>();

const emit = defineEmits<{ refresh: []; theme: []; logout: [] }>();
</script>

<template>
  <header class="sticky top-0 z-40 w-full border-b bg-background">
    <div class="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
      <!-- 品牌标识 -->
      <BrandLockup
        class="shrink-0"
        brand="Lume"
        :tagline="demo ? '公开演示 · 虚构数据' : undefined"
      />

      <!-- 右侧控制区 -->
      <div class="flex items-center gap-2 sm:gap-3">
        <span
          id="last-refresh"
          class="mr-1 hidden text-sm tabular-nums text-muted-foreground md:inline-block"
        >
          {{ refreshedAt ? `${formatTime(refreshedAt)} 更新` : "尚未刷新" }}
        </span>

        <Button
          id="refresh-button"
          variant="outline"
          size="icon-sm"
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
          size="icon-sm"
          type="button"
          aria-label="切换深浅色主题"
          title="切换主题"
          @click="emit('theme')"
        >
          <AppIcon name="theme" />
        </Button>

        <a
          v-if="demo"
          class="inline-flex h-8 items-center justify-center rounded-md bg-secondary px-3 text-sm font-medium text-secondary-foreground shadow-sm transition-colors hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
          class="text-muted-foreground hover:text-foreground"
          type="button"
          @click="emit('logout')"
        >
          退出
        </Button>
      </div>
    </div>
  </header>
</template>
