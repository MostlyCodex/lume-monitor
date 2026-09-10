# 开发与发布参考

## 本地验证

使用 Node.js 22.12+。`worker/` 包含 Worker 与前端构建依赖，仓库根目录包含测试和格式化工具。Vue 类型检查所用的 TypeScript 固定为兼容版本，两处依赖需一起更新。

```bash
npm ci
npm --prefix worker ci
npx playwright install chromium
npm run test:ci
```

Agent 改动另在 `agent/` 执行 `go test ./...` 和 `go vet ./...`。Linux 上执行 `sh deploy/test-upgrade-retention.sh`、`sh deploy/test-agent-upgrade.sh`、`sh deploy/test-agent-audit.sh`，验证备份保留、升级回滚和远端变更清单。

测试只使用虚构节点、保留域名和测试密钥。不得导入生产数据库或私有配置。

## 验证范围

- 管理工具：完整密钥核对、来源校验、部署失败续做、恢复探针冲突。
- Worker：签名与重放保护、管理接口认证、节点退役、历史聚合和面板权限。
- 本地集成：隔离 D1 数据库，验证新安装迁移与现有数据库升级；不连接生产 D1。
- 浏览器：实际面板、虚构数据、桌面及移动端、主题、图表和公开演示。
- 性能：`bash scripts/benchmark-agent.sh`；结果不得包含真实节点或密钥。

数据库变更需同步更新新安装和升级迁移链，并验证现有数据保留。

## 前端开发

```bash
npm run dev:frontend       # Vite 热更新，使用虚构数据
npm run build:frontend     # 生成 Worker 面板及 /demo/ 入口
npm run format:frontend    # 统一 Vue / TypeScript / CSS 格式
```

源码位于 `worker/frontend/`。`App.vue` 仅组合页面和应用状态；子组件通过 props 与事件交互。

| 目录 | 职责 |
| --- | --- |
| `components/` | Vue 模板、局部交互和图表挂载 |
| `composables/` | 请求生命周期、缓存、轮询、偏好与设置草稿 |
| `domain/` | 不依赖页面状态的指标计算、格式化和展示模型 |
| `services/` | API 与演示数据适配、图片校验和压缩 |
| `charts/` | 时间序列对齐、uPlot 配置和丢包标记 |
| `styles/` | 主题、通用基础、页面分区和响应式样式；入口固定加载顺序 |
| `types.ts` | 前端使用的公开 API 契约 |

组件不直接请求 API。异步响应须检查所属会话和节点；监听器、计时器及图表实例在所属作用域销毁时清理。设置先编辑草稿，成功写入浏览器存储后才提交。注释说明约束和取舍，不重复代码含义。

`worker/public/dashboard/`、`worker/public/demo/` 是构建产物，不提交 Git；修改组件或 `frontend/static/` 中的背景后重新构建。uPlot 随详情按需加载，生产包不依赖外部 CDN。原浏览器设置键和 `/dashboard/?node=...` 链接继续有效。

`npm run check` 包括生产构建、前端严格类型检查、格式检查和领域测试；Playwright 验证实际交互、样式、异步竞争与图表清理。新增行为优先通过公开输入输出验证，不读取源码字符串断言实现方式。

## 管理状态

`tools/lumectl.mjs` 提供交互菜单和命令入口；`tools/management.mjs` 定义导入校验和可重试的配置下发逻辑。所有管理数据统一存放在 `.lume/`。

`terminal-output.mjs` 统一输入与输出块的分隔，`remote-changes.mjs` 解析、校验并汇总变更元数据。VPS 操作由 `deploy/audit-agent.sh` 包装：操作前快照受管文件，退出时比对内容、权限和服务状态。文本行号来自 `diff`，快照与差异内容仅在远端临时目录内供 root 读取，完成后清理；本机只接收路径与行号。Agent 自行写入的采样、暂存和周期流量数据不纳入配置变更清单。

`GET /api/v1/admin/key-inventory` 仅允许管理员访问，返回完整节点 ID、密钥 HMAC 校验值和撤销列表，不返回密钥明文。接管时逐一比对；发布密钥前核对上次快照，防止旧管理副本覆盖线上变更。检查与 Cloudflare Secret 写入之间并非原子事务，管理操作应串行执行。

下线保存配置与被移除的对端探针；恢复轮换密钥并等待部署后的上报。下发失败保留待处理标记，已经完成的节点不必重新处理。

## 演示网页

`worker/frontend/src/demo/data.js` 是共享的虚构数据源，浏览器测试和公开演示使用同一套数据。演示模式不请求监控数据 API。

```bash
npm --prefix worker run demo:build
npm --prefix worker run preview:dashboard
```

本地访问 `/demo/`。构建器从实际面板生成演示 HTML，并将允许公开的资源输出到 `demo-dist/`；不要向这个目录放入私有文件。

仓库维护者在 GitHub Settings → Pages 选择 GitHub Actions 作为发布源。`.github/workflows/demo.yml` 会在相关改动推送到 main 后构建并发布，也可手动触发。Fork 使用各自的 Pages 地址。

## 更新 Worker

在 `worker/` 执行 `npm run deploy -- --var APP_VERSION:1.0.0`，先构建前端再部署。后续版本将 `APP_VERSION` 替换为包版本；此参数覆盖私有配置中的旧值。管理菜单中的 Worker 部署也经过同一构建入口；构建失败会停止发布。不要跳过构建而直接发布旧静态资源。

## 发布版本

当前发布版本为 **v1.0.0**。源码标签、根目录与 `worker/` 的 `package.json` 和锁文件、`wrangler.example.jsonc` 中的 `APP_VERSION` 使用同一版本。

后续发布先更新版本和相关手册，提交后推送 `main`，再创建并推送对应的 `vX.Y.Z` 标签。版本标签发布后不复用。

`.github/workflows/release.yml` 校验标签与包版本，完成测试后构建 Linux amd64/arm64 Agent，发布二进制、`SHA256SUMS` 和构建信息。管理工具自动选择架构并获取相应版本；面板仍通过 `npm run deploy` 构建和部署。

Agent 二进制缓存位于 `.lume/cache/agents-v1/`，按版本和架构区分，复用前重新计算摘要。安装器使用指定版本，核对发布校验和；校验失败不降级为源码构建。上传配置前先创建权限 0700 的暂存目录。升级器保留最近 3 份校验过的备份，并在启动验证失败时回滚监控文件。
