<script setup lang="ts">
import { computed } from "vue";
import type { HistoryEvent } from "../types";
import { formatTime } from "../domain/format";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { Badge } from "./ui/badge";

const props = defineProps<{ events: HistoryEvent[]; hours: number }>();

const recentEvents = computed(() =>
  [...props.events].sort((a, b) => b.timestamp - a.timestamp).slice(0, 5),
);

function severityVariant(value: string): "healthy" | "degraded" | "critical" {
  if (value === "P1" || value === "critical") return "critical";
  if (value === "INFO" || value === "healthy") return "healthy";
  return "degraded";
}
</script>

<template>
  <Card id="detail-events" class="border-border/80 bg-card">
    <CardHeader class="p-5 pb-3">
      <div class="flex items-center justify-between">
        <div>
          <span class="text-[11px] font-mono text-muted-foreground uppercase tracking-wider block"
            >EVENTS</span
          >
          <CardTitle class="text-base font-semibold mt-0.5">运行时事件</CardTitle>
        </div>
        <Badge variant="outline" class="text-xs font-mono">
          {{ recentEvents.length }} 条记录
        </Badge>
      </div>
    </CardHeader>

    <CardContent class="p-5 pt-2">
      <div v-if="recentEvents.length" class="space-y-3">
        <div
          v-for="(event, index) in recentEvents"
          :key="`${event.timestamp}:${index}`"
          class="timeline-item flex items-start gap-3 rounded-lg border border-border/40 bg-muted/20 p-3 text-xs transition-colors hover:bg-muted/30"
        >
          <Badge
            :variant="severityVariant(event.severity)"
            class="h-5 w-5 p-0 justify-center shrink-0 rounded-full font-bold"
          >
            {{ severityVariant(event.severity) === "healthy" ? "✓" : "!" }}
          </Badge>
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between gap-2">
              <strong class="font-semibold text-foreground truncate">{{
                event.title || "状态事件"
              }}</strong>
              <time class="shrink-0 font-mono text-[11px] text-muted-foreground">
                {{ formatTime(event.timestamp, hours > 24) }}
              </time>
            </div>
            <p class="text-muted-foreground text-xs mt-0.5 break-words">
              {{ event.detail || "没有更多详情" }}
            </p>
          </div>
        </div>
      </div>

      <div
        v-else
        class="flex flex-col items-center justify-center p-8 text-center text-muted-foreground"
      >
        <span class="text-2xl text-emerald-500 mb-1">✓</span>
        <strong class="text-xs font-semibold text-foreground">区间内没有异常事件</strong>
        <span class="text-[11px] mt-0.5">重启、Agent 版本和服务变化均会记录在这里</span>
      </div>
    </CardContent>
  </Card>
</template>
