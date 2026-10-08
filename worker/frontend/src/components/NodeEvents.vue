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

function dotClass(value: string) {
  if (value === "P1" || value === "critical") return "bg-status-bad";
  if (value === "INFO" || value === "healthy") return "bg-status-ok";
  return "bg-status-warn";
}
</script>

<template>
  <Card id="detail-events">
    <CardHeader class="grid-cols-[1fr_auto] items-center">
      <CardTitle>运行时事件</CardTitle>
      <Badge variant="outline" class="tabular-nums"> {{ recentEvents.length }} 条记录 </Badge>
    </CardHeader>

    <CardContent>
      <ul v-if="recentEvents.length" class="divide-y">
        <li
          v-for="(event, index) in recentEvents"
          :key="`${event.timestamp}:${index}`"
          class="timeline-item flex items-start gap-3 py-3 first:pt-0 last:pb-0"
        >
          <span
            class="mt-1.5 size-2 shrink-0 rounded-full"
            :class="dotClass(event.severity)"
            aria-hidden="true"
          ></span>
          <div class="min-w-0 flex-1">
            <div class="flex items-baseline justify-between gap-2">
              <strong class="truncate text-sm font-medium">{{ event.title || "状态事件" }}</strong>
              <time class="shrink-0 text-xs tabular-nums text-muted-foreground">
                {{ formatTime(event.timestamp, hours > 24) }}
              </time>
            </div>
            <p class="mt-1 break-words text-sm text-muted-foreground">
              {{ event.detail || "没有更多详情" }}
            </p>
          </div>
        </li>
      </ul>

      <div v-else class="flex flex-col items-center justify-center gap-1 py-8 text-center">
        <strong class="text-sm font-medium">区间内没有异常事件</strong>
        <span class="text-sm text-muted-foreground">重启、Agent 版本和服务变化均会记录在这里</span>
      </div>
    </CardContent>
  </Card>
</template>
