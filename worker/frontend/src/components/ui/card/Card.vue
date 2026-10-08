<script setup lang="ts">
import { type HTMLAttributes } from "vue";
import { cn } from "../../../lib/utils";
const props = defineProps<{ class?: HTMLAttributes["class"] }>();
</script>
<template>
  <!-- shadcn v4 Card；手机上内边距与间距从 24px 收为 16px -->
  <div
    :class="
      cn(
        'flex flex-col gap-4 rounded-xl border bg-card py-4 text-card-foreground shadow-sm sm:gap-6 sm:py-6',
        props.class,
      )
    "
  >
    <slot />
  </div>
</template>
