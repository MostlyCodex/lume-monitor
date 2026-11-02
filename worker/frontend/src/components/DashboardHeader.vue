<script setup lang="ts">
import AppIcon from "./AppIcon.vue";
import BrandLockup from "./BrandLockup.vue";
import { formatTime } from "../domain/format";
import { Button } from "./ui/button";

defineProps<{
  refreshedAt?: number;
  refreshing: boolean;
  demo: boolean;
  /** 只在节点列表显示搜索框 */
  showSearch: boolean;
}>();

const search = defineModel<string>("search", { default: "" });
const emit = defineEmits<{ refresh: []; theme: []; logout: [] }>();
</script>

<template>
  <!-- 顶栏透明，只做背景模糊，让下方光晕连续透出 -->
  <header class="sticky top-0 z-40 w-full backdrop-blur-xl backdrop-saturate-150">
    <div class="mx-auto flex h-16 max-w-7xl items-center gap-1.5 px-4 sm:px-6 lg:px-8">
      <BrandLockup
        class="mr-auto shrink-0"
        brand="Lume"
        :tagline="demo ? '公开演示，虚构数据' : undefined"
      />

      <span id="last-refresh" class="mr-2 hidden text-[13px] text-muted-foreground lg:inline-block">
        {{ refreshedAt ? `${formatTime(refreshedAt)} 更新` : "尚未刷新" }}
      </span>

      <label
        v-if="showSearch"
        class="glass relative mr-1.5 hidden h-[34px] w-52 rounded-[10px] sm:block"
      >
        <AppIcon
          name="search"
          class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          id="node-search"
          v-model="search"
          type="search"
          placeholder="搜索节点"
          aria-label="搜索节点名称、地区"
          autocomplete="off"
          class="h-full w-full min-w-0 rounded-[10px] bg-transparent pl-9 pr-3 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </label>

      <Button
        id="refresh-button"
        variant="ghost"
        size="icon-sm"
        class="text-muted-foreground hover:text-foreground"
        :disabled="refreshing"
        aria-label="立即刷新"
        title="立即刷新"
        @click="emit('refresh')"
      >
        <AppIcon name="refresh" :class="{ 'animate-spin': refreshing }" />
      </Button>

      <Button
        id="theme-button"
        variant="ghost"
        size="icon-sm"
        class="text-muted-foreground hover:text-foreground"
        type="button"
        aria-label="切换深浅色主题"
        title="切换主题"
        @click="emit('theme')"
      >
        <AppIcon name="theme" />
      </Button>

      <a
        v-if="demo"
        class="inline-flex h-8 items-center justify-center rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
  </header>
</template>
