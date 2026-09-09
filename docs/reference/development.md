# 开发与发布参考

## 本地验证

用户部署只安装 `worker/` 的 Wrangler；开发测试依赖安装在仓库根目录。

```bash
npm ci
npm --prefix worker ci
npm --prefix worker run check
npm --prefix worker run test:integration
npx playwright install chromium
npm --prefix worker run test:browser
```

Agent 改动另在 `agent/` 执行 `go test ./...` 和 `go vet ./...`。Linux 上执行 `sh deploy/test-upgrade-retention.sh` 验证升级备份保留。

测试只使用虚构节点、保留域名和测试密钥。不得导入生产数据库或私有配置。

## 验证范围

- 管理工具：完整密钥核对、来源校验、部署失败续做、恢复探针冲突。
- Worker：签名与重放保护、管理接口认证、节点退役、历史聚合和面板权限。
- 本地集成：隔离 D1 数据库，验证新安装迁移与现有数据库升级；不连接生产 D1。
- 浏览器：实际面板、虚构数据、桌面及移动端、主题、图表和公开演示。
- 性能：`bash scripts/benchmark-agent.sh`；结果不得包含真实节点或密钥。

数据库变更需同步更新新安装和升级迁移链，并验证现有数据保留。

## 管理状态

`tools/lumectl.mjs` 提供交互菜单和命令入口；`tools/management.mjs` 定义导入校验和可重试的配置下发逻辑。所有管理数据统一存放在 `.lume/`。

`GET /api/v1/admin/key-inventory` 仅允许管理员访问，返回完整节点 ID、密钥 HMAC 校验值和撤销列表，不返回密钥明文。接管时逐一比对；发布密钥前核对上次快照，防止旧管理副本覆盖线上变更。检查与 Cloudflare Secret 写入之间并非原子事务，管理操作应串行执行。

下线保存配置与被移除的对端探针；恢复轮换密钥并等待部署后的上报。下发失败保留待处理标记，已经完成的节点不必重新处理。

## 演示网页

`worker/public/demo/data.js` 是共享的虚构数据源，浏览器测试和公开演示使用同一套数据。演示模式不请求监控数据 API。

```bash
node tools/build-demo.mjs
npm --prefix worker run preview:dashboard
```

本地访问 `/demo/`。构建器从实际面板生成演示 HTML，并将允许公开的资源输出到 `demo-dist/`；不要向这个目录放入私有文件。

仓库维护者在 GitHub Settings → Pages 选择 GitHub Actions 作为发布源。`.github/workflows/demo.yml` 会在相关改动推送到 main 后构建并发布，也可手动触发。Fork 使用各自的 Pages 地址。

## 发布 Agent

`.github/workflows/release.yml` 仅由明确的版本标签触发，运行验证并生成 Linux amd64/arm64 二进制及 `SHA256SUMS`。版本需与根目录和 `worker/package.json` 一致。

安装器使用指定版本，核对发布校验和；校验失败不降级为源码构建。上传配置前先创建权限 0700 的暂存目录。升级器保留最近 3 份校验过的备份，并在启动验证失败时回滚监控文件。
