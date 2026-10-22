<template>
  <div id="loading-view" class="loading-view" role="status" aria-live="polite" aria-busy="true">
    <div class="loading-ridge" aria-hidden="true">
      <svg viewBox="0 0 180 58" focusable="false">
        <path
          class="loading-ridge-shadow"
          pathLength="1"
          d="M3 47 C18 46 29 43 41 38 L58 25 L72 38 L101 9 L119 31 L134 23 L151 39 C160 44 169 46 177 47"
        />
        <path
          class="loading-ridge-line"
          pathLength="1"
          d="M3 47 C18 46 29 43 41 38 L58 25 L72 38 L101 9 L119 31 L134 23 L151 39 C160 44 169 46 177 47"
        />
      </svg>
    </div>
    <span class="sr-only">正在加载</span>
  </div>
</template>

<style scoped>
.loading-view {
  position: relative;
  z-index: 1;
  display: grid;
  min-height: 100vh;
  min-height: 100svh;
  place-items: center;
  padding: 32px 24px;
}
.loading-ridge {
  width: min(180px, 54vw);
}
.loading-ridge svg {
  display: block;
  width: 100%;
  overflow: visible;
  fill: none;
}
.loading-ridge path {
  stroke-linecap: round;
  stroke-linejoin: round;
}
.loading-ridge-shadow {
  stroke: hsl(var(--foreground) / 0.15);
  stroke-width: 1.15;
}
/* The ridge is the only activity cue, so it keeps redrawing until the view is replaced. */
.loading-ridge-line {
  stroke: hsl(var(--foreground));
  stroke-width: 1.8;
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  animation: ridge-cycle 1.8s cubic-bezier(0.22, 0.7, 0.28, 1) 120ms infinite both;
}
@keyframes ridge-cycle {
  0% {
    stroke-dashoffset: 1;
    opacity: 1;
  }
  50%,
  70% {
    stroke-dashoffset: 0;
    opacity: 1;
  }
  92%,
  100% {
    stroke-dashoffset: 0;
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .loading-ridge-line {
    animation: none;
    stroke-dashoffset: 0;
  }
}
</style>
