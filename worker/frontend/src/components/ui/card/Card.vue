<script setup lang="ts">
import { type HTMLAttributes } from "vue";
import { cn } from "../../../lib/utils";
const props = defineProps<{ class?: HTMLAttributes["class"] }>();
</script>
<template>
  <!-- 毛玻璃卡片；手机上内边距与间距从 24px 收为 16px -->
  <div
    :class="
      cn(
        'glass flex flex-col gap-4 rounded-2xl py-4 text-card-foreground sm:gap-5 sm:py-6',
        props.class,
      )
    "
  >
    <slot />
  </div>
</template>
