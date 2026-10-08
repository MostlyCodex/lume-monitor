<script setup lang="ts">
import { computed } from "vue";
import BrandLockup from "./BrandLockup.vue";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "./ui/card";
import { Button } from "./ui/button";

const emit = defineEmits<{ notify: [message: string, error?: boolean] }>();

const steps = [
  { title: "发送命令", detail: "在已绑定的 Telegram 机器人私聊中发送 /panel" },
  { title: "打开单次链接", detail: "链接 5 分钟内有效，只能使用一次" },
  { title: "保持登录", detail: "登录状态在当前浏览器保留 30 天" },
];

const message = computed(() => {
  const reason = new URLSearchParams(location.search).get("login");
  return reason === "expired"
    ? "登录链接已过期或已使用，请重新发送 /panel。"
    : reason === "error"
      ? "登录暂时未完成，请重新获取一次性链接。"
      : "";
});

async function copyCommand() {
  try {
    await navigator.clipboard.writeText("/panel");
    emit("notify", "已复制 /panel 命令到剪贴板");
  } catch {
    emit("notify", "请手动在 Telegram 中发送 /panel", true);
  }
}
</script>

<template>
  <main
    id="auth-view"
    class="flex min-h-screen items-center justify-center bg-background p-4 sm:p-6"
  >
    <Card class="w-full max-w-sm">
      <CardHeader>
        <BrandLockup brand="Lume" tagline="MINIMAL OBSERVABILITY" class="mb-4" />
        <CardTitle class="text-xl">登录面板</CardTitle>
        <CardDescription>
          在已绑定的 Telegram 机器人私聊中发送
          <code class="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">/panel</code>
          获取一次性登录链接。
        </CardDescription>
      </CardHeader>

      <CardContent class="flex flex-col gap-6">
        <ol class="flex flex-col gap-4 text-sm">
          <li v-for="(step, index) in steps" :key="step.title" class="flex items-start gap-3">
            <span
              class="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular-nums"
              >{{ index + 1 }}</span
            >
            <div class="flex flex-col gap-0.5">
              <span class="font-medium">{{ step.title }}</span>
              <span class="text-muted-foreground">{{ step.detail }}</span>
            </div>
          </li>
        </ol>

        <div
          v-if="message"
          id="login-message"
          class="rounded-lg border px-4 py-3 text-sm text-status-warn"
          role="alert"
        >
          {{ message }}
        </div>

        <div class="flex flex-col gap-2 sm:flex-row">
          <Button id="copy-panel-command" class="flex-1" @click="copyCommand">
            复制 /panel 命令
          </Button>
          <a
            class="inline-flex h-9 flex-1 items-center justify-center rounded-md border bg-background px-4 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:border-input dark:bg-white/[0.045] dark:hover:bg-white/[0.075]"
            href="https://web.telegram.org/"
            target="_blank"
            rel="noreferrer"
          >
            打开 Web Telegram
          </a>
        </div>
      </CardContent>
    </Card>
  </main>
</template>
