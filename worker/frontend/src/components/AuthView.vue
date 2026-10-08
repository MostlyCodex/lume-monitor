<script setup lang="ts">
import { computed } from "vue";
import BrandLockup from "./BrandLockup.vue";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";

const emit = defineEmits<{ notify: [message: string, error?: boolean] }>();

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
    class="flex min-h-screen items-center justify-center p-4 sm:p-6 bg-background"
  >
    <div class="w-full max-w-md space-y-6">
      <Card class="border-border/80 bg-card p-6 shadow-xl">
        <CardHeader class="p-0 pb-6 space-y-4">
          <BrandLockup brand="Lume" tagline="MINIMAL OBSERVABILITY" />
          <div class="space-y-2">
            <Badge variant="healthy" class="px-2.5 py-0.5 text-xs font-normal">
              <span class="h-1.5 w-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse"></span>
              Telegram 安全鉴权登录
            </Badge>
            <CardTitle class="text-xl font-bold tracking-tight text-foreground">
              节点监控 · 一览无余
            </CardTitle>
            <p class="text-xs text-muted-foreground leading-relaxed">
              请在已绑定的 Telegram 私密群或机器人私聊中发送
              <code class="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">/panel</code>
              获取一次性登录链接。
            </p>
          </div>
        </CardHeader>

        <CardContent class="p-0 space-y-5">
          <!-- 登录步骤指引 -->
          <div class="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4">
            <div class="flex items-start gap-3">
              <span
                class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-mono text-xs font-bold"
                >1</span
              >
              <div class="text-xs">
                <strong class="text-foreground block font-medium">发送命令</strong>
                <span class="text-muted-foreground text-[11px]"
                  >在已配置的 Telegram 机器人中发送 /panel</span
                >
              </div>
            </div>
            <div class="flex items-start gap-3">
              <span
                class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-mono text-xs font-bold"
                >2</span
              >
              <div class="text-xs">
                <strong class="text-foreground block font-medium">打开单次链接</strong>
                <span class="text-muted-foreground text-[11px]"
                  >链接具备 5 分钟时效，仅可消耗使用一次</span
                >
              </div>
            </div>
            <div class="flex items-start gap-3">
              <span
                class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-mono text-xs font-bold"
                >3</span
              >
              <div class="text-xs">
                <strong class="text-foreground block font-medium">持久保持认证</strong>
                <span class="text-muted-foreground text-[11px]"
                  >认证会话将在当前浏览器保留 30 天</span
                >
              </div>
            </div>
          </div>

          <!-- 提示信息 -->
          <div
            v-if="message"
            id="login-message"
            class="rounded-md border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-500 font-medium"
            role="alert"
          >
            {{ message }}
          </div>

          <!-- 操作按钮 -->
          <div class="flex items-center gap-3 pt-2">
            <Button
              id="copy-panel-command"
              class="flex-1 text-xs h-9"
              type="button"
              @click="copyCommand"
            >
              复制 /panel 命令
            </Button>
            <a
              class="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-xs font-medium text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground h-9"
              href="https://web.telegram.org/"
              target="_blank"
              rel="noreferrer"
            >
              打开 Web Telegram
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  </main>
</template>
