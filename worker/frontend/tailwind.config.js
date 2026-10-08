const defaultTheme = require("tailwindcss/defaultTheme");

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class", '[data-theme="dark"]'],
  // hover: 只在支持悬停的设备上生效；iOS 点按后会残留 :hover，导致按钮点完仍显示悬停色
  future: { hoverOnlyWhenSupported: true },
  // npm 脚本的 cwd 是 worker/，不加 relative 时 ./src 会被解析成 worker/src（后端代码）
  content: {
    relative: true,
    files: ["./index.html", "./src/**/*.{vue,js,ts,jsx,tsx}"],
  },
  theme: {
    extend: {
      // 拉丁字符与数字使用 Geist（与 ui.shadcn.com 一致），中文回落到系统字体
      fontFamily: {
        sans: ['"Geist Variable"', ...defaultTheme.fontFamily.sans],
      },
      colors: {
        status: {
          ok: "hsl(var(--status-ok))",
          warn: "hsl(var(--status-warn))",
          bad: "hsl(var(--status-bad))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      // 与 shadcn v4 相同的圆角比例：卡片 xl = radius + 4px，按钮 md = radius - 2px
      borderRadius: {
        xl: "calc(var(--radius) + 4px)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [],
};
