<script setup lang="ts">
import { formatUptime } from "../domain/format";
import { Badge } from "./ui/badge";

// 节点只有两种状态：正常上报为“在线”并带运行时长；上报中断或尚无有效数据为置灰的“下线”
defineProps<{ online: boolean; uptimeSeconds?: number | null }>();
</script>

<template>
  <Badge
    :variant="online ? 'healthy' : 'offline'"
    class="node-status tabular-nums"
    :data-online="online"
  >
    <template v-if="online">
      在线
      <span class="font-normal text-muted-foreground">{{ formatUptime(uptimeSeconds) }}</span>
    </template>
    <template v-else>下线</template>
  </Badge>
</template>
