<script setup lang="ts">
import { computed } from "vue";
import type { HistoryEvent } from "../types";
import { formatTime } from "../domain/format";
const props = defineProps<{ events: HistoryEvent[]; hours: number }>();
const recentEvents = computed(() =>
  [...props.events].sort((a, b) => b.timestamp - a.timestamp).slice(0, 5),
);
function severity(value: string) {
  return value === "P1" || value === "critical"
    ? "critical"
    : value === "INFO"
      ? "healthy"
      : "warning";
}
</script>
<template>
  <section class="detail-section" aria-labelledby="detail-events-title">
    <div class="section-heading">
      <div>
        <p class="eyebrow">EVENTS</p>
        <h2 id="detail-events-title">事件</h2>
      </div>
    </div>
    <article class="info-card glass-panel">
      <div id="detail-events" class="timeline-list">
        <div
          v-for="(event, index) in recentEvents"
          :key="`${event.timestamp}:${index}`"
          class="timeline-item"
        >
          <div class="timeline-icon" :class="`is-${severity(event.severity)}`">
            {{ severity(event.severity) === "healthy" ? "✓" : "!" }}
          </div>
          <div>
            <strong>{{ event.title || "状态事件" }}</strong
            ><span>{{ event.detail || "没有更多详情" }}</span>
          </div>
          <time>{{ formatTime(event.timestamp, hours > 24) }}</time>
        </div>
        <div v-if="!events.length" class="empty-state">
          <i>✓</i><strong>区间内没有事件</strong><span>重启、Agent 版本和服务变化会显示在这里</span>
        </div>
      </div>
    </article>
  </section>
</template>
