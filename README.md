# Lume

轻量、自托管的 Linux VPS 监控：资源状态、线路质量和历史图表，一个面板看清。

[在线体验](https://mostlycodex.github.io/lume-monitor/) · [部署与管理](docs/guide.md) · [参与开发](CONTRIBUTING.md)

演示网页使用虚构数据，无需登录，可体验节点详情、图表、深浅主题和显示设置。

## 能监测什么

- **主机资源**：CPU、内存、磁盘、流量、启动时间和 Agent 状态。
- **线路质量**：ICMP 延迟与丢包、TCP 建连延迟与失败率、节点间链路。
- **服务状态**：只读监测所选 systemd 服务。
- **历史与查询**：资源和线路历史、运行事件、IP 变化；Telegram `/status` 和 `/panel`。

Agent 通过 HTTPS 主动上报，Cloudflare Worker 接收，D1 保存数据。VPS 不新增监听端口，也不需要 Docker、Node.js 或数据库。

## 部署和日常管理

本机准备 Node.js 22+、Git 和 SSH，VPS 使用 systemd Linux。创建 Cloudflare 账号和 Telegram Bot 后，跟随[操作指南](docs/guide.md)运行交互式管理工具：

```bash
cd worker
npm ci
npm run manage
```

同一个菜单完成从零部署、接管、新增、配置、更新、下线和恢复节点。三网探针可逐项配置或复用已有节点，确认摘要后直接部署。私有管理状态统一存放在 `.lume/`，请加密备份。

## 边界

每台节点使用独立签名密钥。Agent 只执行配置中列出的观测，不提供远程终端、业务服务重启或线路自动切换。Telegram 提供按需查询，不主动发送告警或日报。

适合关注 VPS 状态与线路质量、希望减少维护负担的个人自托管场景。

## 项目信息

MIT 许可。安全边界见 [SECURITY.md](SECURITY.md)，测量定义见[测量口径](docs/reference/monitoring-methodology.md)，实现结构见[架构说明](docs/reference/architecture.md)。
