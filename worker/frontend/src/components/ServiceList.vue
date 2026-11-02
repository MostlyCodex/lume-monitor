<script setup lang="ts">
import type { ServiceStatus } from "../types";
import { serviceDisplayLabel, serviceStateText } from "../domain/probes";

defineProps<{ services: ServiceStatus[] }>();

// 运行正常为对勾，故障为叉，其余（启动中、未运行等）为感叹号
function serviceTone(state: string) {
  if (state === "active") return "ok";
  if (state === "failed") return "bad";
  return "warn";
}

const toneClass = { ok: "text-brand", bad: "text-status-bad", warn: "text-status-warn" };
</script>

<template>
  <div id="detail-services" class="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5">
    <span v-if="!services.length" class="detail-service is-neutral text-sm text-muted-foreground">
      服务监测：暂无上报
    </span>
    <span
      v-for="service in services"
      :key="service.name"
      class="detail-service inline-flex items-center gap-1.5 text-sm text-foreground"
      :data-state="service.state"
      :title="`${serviceDisplayLabel(service)}：${serviceStateText(service.state)}`"
      :aria-label="`${serviceDisplayLabel(service)} ${serviceStateText(service.state)}`"
    >
      <svg
        viewBox="0 0 16 16"
        class="size-3.5 shrink-0"
        :class="toneClass[serviceTone(service.state)]"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="8" cy="8" r="6.5" />
        <path v-if="serviceTone(service.state) === 'ok'" d="M5.2 8.2l1.9 1.9 3.7-3.9" />
        <path
          v-else-if="serviceTone(service.state) === 'bad'"
          d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4"
        />
        <path v-else d="M8 4.8v3.7M8 10.9v.1" />
      </svg>
      {{ serviceDisplayLabel(service) }}
    </span>
  </div>
</template>
