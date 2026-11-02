<script setup lang="ts">
import markUrl from "../assets/lume-mark.svg?no-inline";

defineProps<{ brand: string; tagline?: string }>();
</script>

<template>
  <div class="brand-lockup">
    <img class="lume-mark" :src="markUrl" width="22" height="22" alt="" aria-hidden="true" />
    <strong data-dashboard-brand class="brand-name">{{ brand }}</strong>
    <small v-if="tagline" class="brand-tagline">{{ tagline }}</small>
  </div>
</template>

<style scoped>
.brand-lockup {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.lume-mark {
  display: block;
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
}
.brand-name {
  font-size: 17px;
  font-weight: 600;
  line-height: 1;
}
.brand-tagline {
  color: hsl(var(--muted-foreground));
  font-size: 12px;
}
</style>
