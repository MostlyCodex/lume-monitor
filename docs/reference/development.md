# 开发与发布参考

## 本地验证

使用 Node.js 22.12+ 和 Go 1.26+。`worker/` 包含 Worker 与前端构建依赖，仓库根目录包含测试和格式化工具。Vue 类型检查所用的 TypeScript 固定为兼容版本，两处依赖需一起更新。

```bash
npm ci
npm --prefix worker ci
npx playwright install chromium
npm run test:ci
```

Agent 改动另在 `agent/` 执行 `go test ./...` 和 `go vet ./...`。Linux 上执行 `sh deploy/test-upgrade-retention.sh`、`sh deploy/test-agent-upgrade.sh`、`sh deploy/test-agent-audit.sh`、`sh deploy/test-agent-uninstall.sh`，验证备份保留、升级回滚和远端变更清单。

测试只使用虚构节点、保留域名和测试密钥。不得导入生产数据库或私有配置。

## 验证范围

- 管理工具：完整密钥核对、来源校验、部署失败续做、恢复探针冲突。
- Worker：签名与重放保护、管理接口认证、节点退役、历史聚合和面板权限。
- 本地集成：隔离 D1 数据库，验证新库初始化、旧库更新记录转换、失败重试与数据保留；不连接生产 D1。
- 浏览器：实际面板、虚构数据、桌面及移动端、主题、图表和公开演示。
- 性能：`bash scripts/benchmark-agent.sh`；结果不得包含真实节点或密钥。

Linux CI 从固定 Git 提交构建 1.0.0、1.0.1、1.0.2 与当前 Agent，运行实际采集，再发送至对应 Worker，验证入库和面板读取；Windows 跳过真实 Agent 版本矩阵。完整矩阵需要 Git 历史，浅克隆先执行 `git fetch --unshallow`。

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

永久删除由 `tools/node-deletion.mjs` 编排：撤销凭据、核对并卸载远端 Agent、清理本地备份与对端配置，最后调用 `worker/src/node-deletion.ts` 原子清理 D1。进度保存在 `pendingDeletes`，全部成功后移除；永久删除不会生成恢复档案。相关测试覆盖隔离数据库的所有节点数据表、卸载安全检查及中断续做。

## 演示网页

`worker/frontend/src/demo/data.js` 是共享的虚构数据源，浏览器测试和公开演示使用同一套数据。演示模式不请求监控数据 API。

```bash
npm --prefix worker run demo:build
npm --prefix worker run preview:dashboard
```

本地访问 `/demo/`。构建器从实际面板生成演示 HTML，并将允许公开的资源输出到 `demo-dist/`；不要向这个目录放入私有文件。

仓库维护者在 GitHub Settings → Pages 选择 GitHub Actions 作为发布源。`.github/workflows/demo.yml` 会在相关改动推送到 main 后构建并发布，也可手动触发。Fork 使用各自的 Pages 地址。

## 数据库脚本

数据库脚本统一放在 `worker/database/`，由 `tools/database.mjs` 识别库结构和已完成记录：

| 路径 | 执行时机 |
| --- | --- |
| `initialize.sql` | 空库，仅执行一次 |
| `upgrade-v3.sql` | 早期固定节点结构的一次性升级，保留已有数据 |
| `updates/` | 新库和旧库共用，按编号执行尚未完成的兼容更新 |
| `cleanup/` | 新 Worker 部署并通过版本检查后，执行结构清理 |

后续兼容更新只在 `updates/` 添加一份 SQL。已发布 SQL 的执行内容不改写；旧更新记录保留，并映射到统一编号，避免重复建表或加列。单个更新与完成标记在同一 D1 批次提交，失败后可重跑。未知数据库在初始化前停止。

Wrangler 的 `migrations_dir` 配置和 `d1_migrations` 记录表名称属于工具接口，继续保留；管理工具会自动备份并更新旧目录配置。使用 `npm run deploy` 或本地 `npm run db:local`，无需自行选择脚本目录。

## 更新与回滚 Worker

在 `worker/` 执行 `npm run deploy`，管理菜单共用以下流程，`APP_VERSION` 自动取包版本：

1. 初始化数据库或应用兼容更新。
2. 构建 Vue 前端并部署 Worker。新代码须可读写清理前后的结构。
3. 核对线上版本与结构能力后执行清理。部署或核验失败时保留过渡字段，重试即可。

清理不能放在新代码上线之前；重试时检查实际结构，不能只依赖完成标记。部署完成后先更新一个 Agent，确认配置、面板与上报，再更新其余节点。

回滚使用 `npx wrangler versions list` 查看版本 ID，然后运行 `npm run worker:rollback -- <版本ID>`：

- 已验证的 Worker 源码版本为 **1.0.1、1.0.2、1.0.3**，均验证接收 1.0.0 至当前 Agent 的报告。版本号需对应项目原始代码；自改同名版本不在测试保证内。
- 1.0.0 Worker 不接受新版 Agent 的上报字段，即使补回旧数据库列也不兼容，管理命令会提前拒绝。过渡结构下也拒绝回滚至 1.0.1。
- 仅处理同一 D1、单版本承接 100% 流量的部署。内部用 `wrangler versions deploy` 切换已保存版本，不强制覆盖 Cloudflare 对 Secrets 变化的阻止。
- 回滚后核对实际版本、面板读取，以及操作前在线节点的新采集报告；旧暂存报告不能完成确认。最长等待约 20 分钟，以覆盖最大上报间隔；原先离线的节点不计入。
- 验证失败时尝试恢复原版本，并再次核验。发生其他并发部署时停止自动恢复。该流程不回滚 Agent、数据库数据或已删除记录。

版本策略在 `tools/worker-rollback.mjs`，真实版本矩阵在 `worker/test/version-compatibility.mjs`。新增可回滚版本时同步更新矩阵，不能仅凭 `/healthz` 可用就宣称兼容。

## 发布版本

当前源码版本为 **v1.0.3**。根目录与 `worker/` 的 `package.json` 和锁文件、`wrangler.example.jsonc` 中的 `APP_VERSION` 使用同一版本。

源码更新：同步包版本与相关手册，测试后提交并推送 `main`。仅发布源码无需创建标签；需要发布预编译 Agent 时，另行创建并推送 `vX.Y.Z` 标签，已发布标签不复用。

`.github/workflows/release.yml` 校验标签与包版本，完成测试后构建 Linux amd64/arm64 Agent，发布二进制、`SHA256SUMS` 和构建信息。管理工具自动选择架构并获取相应版本；面板仍通过 `npm run deploy` 构建和部署。

Agent 二进制缓存位于 `.lume/cache/agents-v1/`，按版本和架构区分，复用前重新计算摘要。安装器使用指定版本，核对发布校验和；校验失败不降级为源码构建。上传配置前先创建权限 0700 的暂存目录。升级器保留最近 3 份校验过的备份，并在启动验证失败时回滚监控文件。
