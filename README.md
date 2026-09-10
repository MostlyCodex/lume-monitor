# Lume

轻量、自托管的 Linux VPS 监控：资源状态、线路质量和历史图表，一个面板看清。

[v1.0.1](https://github.com/MostlyCodex/lume-monitor/releases/tag/v1.0.1) · [在线体验](https://mostlycodex.github.io/lume-monitor/) · [部署与管理](docs/guide.md) · [参与开发](CONTRIBUTING.md)

演示网页使用虚构数据，无需登录，可体验节点详情、图表、深浅主题和自定义背景。

## 能监测什么

- **主机资源**：CPU、内存、磁盘、流量、启动时间和 Agent 状态。
- **网络流量**：自动或指定统计网卡，可按月设置周期流量与重置日。
- **线路质量**：ICMP 延迟与丢包、TCP 建连延迟与失败率、节点间链路。
- **服务状态**：只读监测所选 systemd 服务。
- **历史与查询**：资源和线路历史、运行事件、IP 变化；Telegram `/status` 和 `/panel`。

Agent 通过 HTTPS 主动上报，Cloudflare Worker 接收，D1 保存数据。面板采用 Vue 3、TypeScript 和 Vite。VPS 不新增监听端口，也不需要 Docker、Node.js 或数据库。

## 部署和日常管理

本机准备 Node.js 22.12+、Git 和 SSH，VPS 使用 systemd Linux。创建 Cloudflare 账号和 Telegram Bot 后，跟随[操作指南](docs/guide.md)运行交互式管理工具：

```bash
cd worker
npm ci
npm run manage
```

同一个菜单完成从零部署、接管、新增、配置、更新、下线和恢复节点。三网探针可逐项配置或复用已有节点，保存后可立即部署或稍后继续，工具核对 Agent 实际加载的配置后确认生效。私有管理状态统一存放在 `.lume/`，请加密备份。

## 边界

每台节点使用独立签名密钥。Agent 只执行配置中列出的观测，不提供远程终端、业务服务重启或线路自动切换。Telegram 提供按需查询，不主动发送告警或日报。

适合关注 VPS 状态与线路质量、希望减少维护负担的个人自托管场景。

## 代码结构

```text
lume-monitor/
├── agent/                      # Go Agent，在 VPS 上采集并上报数据
│   ├── cmd/vpsmon-agent/       # 程序入口
│   ├── internal/               # 采集、探测与上报实现
│   │   ├── check/              # 只读 systemd 服务检查
│   │   ├── collect/            # 主机资源与网络指标采集
│   │   ├── config/             # 配置加载与校验
│   │   ├── model/              # 上报数据结构
│   │   ├── probe/              # ICMP / TCP 网络探针
│   │   ├── sender/             # 请求签名与 HTTPS 上报
│   │   ├── spool/              # 上报失败时的本地缓存
│   │   └── traffic/            # 按周期累计流量与持久化
│   └── testdata/               # 测试与性能基准配置
├── worker/                     # Cloudflare 服务端与 Web 面板
│   ├── src/                    # API、认证、历史查询、Telegram 与定时任务
│   ├── frontend/               # Vue 3 前端源码与构建配置
│   │   ├── src/
│   │   │   ├── components/     # 概览、节点详情、设置与图表组件
│   │   │   ├── composables/    # 请求、缓存、轮询及设置草稿
│   │   │   ├── domain/         # 指标计算、格式化与展示模型
│   │   │   ├── services/       # API、演示数据适配及图片处理
│   │   │   ├── charts/         # uPlot 数据转换与图表选项
│   │   │   ├── styles/         # 主题与响应式样式
│   │   │   └── demo/           # 虚构数据源
│   │   └── static/             # 默认背景与第三方许可
│   ├── public/                 # 安全响应头及自动生成的面板、演示资源
│   ├── migrations/             # 新安装 D1 数据库迁移
│   ├── migrations-v3/          # v3 数据库升级迁移
│   └── test/                   # 单元测试、集成测试与本地预览服务
│       ├── browser/            # 浏览器交互与响应式界面测试
│       └── fixtures/           # 数据库升级测试数据
├── tools/                      # 交互式管理工具与演示页构建器
│   └── test/                   # 管理流程、输入校验与构建测试
├── deploy/                     # Agent 安装、升级、卸载脚本及配置示例
├── scripts/                    # Agent 性能基准脚本
├── docs/                       # 部署管理指南与技术文档
│   ├── assets/                 # 文档图片
│   └── reference/              # 架构、开发发布与测量口径
├── design-system/monitor/      # 面板视觉规范
│   └── pages/                  # 页面级设计规范
└── .github/workflows/          # 自动测试、演示页发布与 Agent 发版
```

## 项目信息

MIT 许可。安全边界见 [SECURITY.md](SECURITY.md)，测量定义见[测量口径](docs/reference/monitoring-methodology.md)，实现结构见[架构说明](docs/reference/architecture.md)。
