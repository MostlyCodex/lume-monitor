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
    <span v-if="!services.length" class="detail-service is-neutral text-sm text-muted-foreground">
      服务监测：暂无上报
    </span>
    <Badge
      v-for="service in services"
      :key="service.name"
      :variant="serviceVariant(service.state)"
      class="detail-service"
      :data-state="service.state"
      :title="`${serviceDisplayLabel(service)}：${serviceStateText(service.state)}`"
      :aria-label="`${serviceDisplayLabel(service)} ${serviceStateText(service.state)}`"
    >
      {{ serviceDisplayLabel(service) }}
    </Badge>
  </div>
</template>
