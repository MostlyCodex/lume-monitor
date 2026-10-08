<script setup lang="ts">
import type { ServiceStatus } from "../types";
import { serviceDisplayLabel, serviceStateText } from "../domain/probes";
import { Badge } from "./ui/badge";

defineProps<{ services: ServiceStatus[] }>();

function serviceVariant(state: string) {
  if (state === "active") return "healthy";
  if (state === "failed") return "critical";
  return "degraded";
}
</script>

<template>
  <div id="detail-services" class="flex flex-wrap items-center gap-2">
    <div v-if="!services.length" class="detail-service is-neutral text-xs text-muted-foreground">
      服务监测：暂无上报
    </div>
    <div
      v-for="service in services"
      :key="service.name"
      class="detail-service inline-flex items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-1.5 shadow-sm text-xs"
      :data-state="service.state"
    >
      <span class="font-medium text-foreground">{{ serviceDisplayLabel(service) }}</span>
      <Badge
        :variant="serviceVariant(service.state)"
        class="font-mono text-[11px] px-1.5 py-0 font-normal"
      >
        {{ serviceStateText(service.state) }}
      </Badge>
    </div>
  </div>
</template>
