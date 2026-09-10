<script setup lang="ts">
import type { ServiceStatus } from "../types";
import { serviceDisplayLabel, serviceStateText } from "../domain/probes";
defineProps<{ services: ServiceStatus[] }>();
</script>
<template>
  <div class="detail-service-list">
    <span v-if="!services.length" class="detail-service is-neutral"
      ><b>服务监测</b><em>暂无上报</em></span
    >
    <span
      v-for="service in services"
      :key="service.name"
      class="detail-service"
      :class="
        service.state === 'active'
          ? 'is-healthy'
          : service.state === 'failed'
            ? 'is-critical'
            : 'is-warning'
      "
      ><i></i><b>{{ serviceDisplayLabel(service) }}</b
      ><em>{{ serviceStateText(service.state) }}</em></span
    >
  </div>
</template>
