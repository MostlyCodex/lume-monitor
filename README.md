# Lume

一个可自托管、面向任意数量 Linux VPS 的轻量监控系统。它由只出站的 Go Agent、Cloudflare Worker、D1、Telegram Bot 和响应式网页面板组成。

**Lume** 取“光与清晰可见”之意：用尽量小的暴露面，把关键状态照亮。

> This repository is a sanitized, self-hostable edition. It contains no production credentials, host addresses, account identifiers, or private deployment data.

![Lume PC 端节点总览与移动端节点详情](docs/assets/lume-showcase.webp)

> PC 与移动端均为项目真实渲染截图；画面使用内置虚构演示数据，不包含生产凭据、主机地址或账号信息。

## 10 分钟快速上线

准备一个 Cloudflare 账号、一个 Telegram Bot 和一台可用 SSH + sudo 登录的 systemd Linux VPS。VPS 无需安装 Node.js、Go、Docker 或数据库；本机只需要 Node.js 22+ 与 SSH，**不需要 Go**。

```bash
git clone https://github.com/MostlyCodex/lume-monitor.git
cd lume-monitor/worker
npm ci
npm run doctor
npm run setup
```

`worker/` 只依赖 Wrangler；测试工具链（TypeScript、Vitest、Playwright）在仓库根目录的独立 `package.json` 中，部署者不会安装它们。

`setup` 会按顺序完成 D1、migrations、Worker、Secrets、Telegram Webhook 和健康检查，并可继续安装首台 Agent。它只部署一次 Worker，并把全部非交互 Secret 用一次 `wrangler secret bulk` 提交；Worker 随后从一次带鉴权的管理调用中记住自己的公开地址，因此不需要为了写回面板 URL 再部署一遍。节点密钥始终以完整 `NODE_KEYS` 映射提交，避免新增节点时误覆盖旧密钥。一般只需准备：

- Cloudflare 登录授权；
- Telegram Bot 用户名和 BotFather 给出的 Token；
- 首台节点的名称、用途、地区及 SSH 别名。

完成后私聊 Bot 执行工具给出的 `/bind ...`，再发送 `/panel` 即可进入面板。图文式流程、每一步会改什么和故障恢复方法见[快速部署指南](docs/quickstart.md)；需要完全手工控制时使用[从零搭建教程](docs/getting-started.md)。

## 通用模型

每台 VPS 使用**同一个 Agent、同一个配置结构和同一套安装脚本**。节点名、用途和数量都不写死在代码或数据库迁移中。

| 层次 | 是否必需 | 作用 |
| --- | --- | --- |
| 基础主机监控 | 是 | CPU、负载、内存、Swap、磁盘、inode、流量、错误、启动与 Agent 状态 |
| systemd 服务监测 | 否 | 监测零个到多个本机服务，只读状态，不重启、不修改 |
| ICMP 通信探针 | 否 | 监测节点到节点或外部参考目标的 RTT 与 Echo 丢包率 |
| TCP 建连探针 | 否 | 监测指定主机与端口的建连耗时和失败率，不发送应用数据 |
| nftables 转发计数 | 否 | 读取明确选择的规则累计命中数，展示增量和每分钟速率 |

新增 VPS 时只需：

1. 在 Worker 的 `NODE_KEYS` 中加入一个任意安全节点 ID 和独立密钥；
2. 复制 `deploy/config.example.json`，填写节点信息和同一密钥；
3. 安装 Agent。

无需修改 Agent/Worker 源码、D1 schema 或面板。已认证的首份报告会自动注册节点及其可选监测项。

## 功能

- 任意数量和任意角色的 VPS 动态注册与展示。
- ICMP 多样本探测，记录 p50/p95、RTT 标准差、丢包率和采样覆盖率。
- 可选 TCP Connect 多样本探测，记录建连延迟与建连失败率；不执行 TLS、HTTP、登录或任意命令。
- 可选 nftables 规则计数观测，只上传名称、命中增量、时间间隔与速率，不上传规则、地址、域名或载荷。
- 首页保持 ICMP 线路质量视图；TCP 与转发活动仅在已配置节点的详情中出现。
- 节点间 `node-link` 探针自动生成通信关系和链路分析。
- Agent 使用 HMAC-SHA256 签名上报，带时间窗、nonce 和重放保护。
- D1 保存最新状态、原始样本、长期聚合、运行事件和 IP 历史。
- Telegram Webhook 仅向已绑定账号提供按需的 `/status`（查看实时状态）、`/panel`（打开监控面板）和 `/help`（查看命令说明）；状态按节点分组展示，不主动推送告警或日报。
- 节点退役是一次显式的运维动作：`retired_at` 只由管理接口写入，上报路径永远不会清除它。因此下线与停机的先后顺序不再影响结果，也不会有对端在下一次上报时把已下线的链路重新点亮。
- 一次性链接登录的自适应毛玻璃面板：首页以动态节点卡片展示 24 小时线路状态格和资源刻度，历史图表进入独立节点详情查看。
- 顶部设置入口可在当前浏览器自定义面板名称、首页文案、节点卡片顺序、显示名、角色、国家和城市；设置不新增网络请求，也不修改监测数据。

## 与主流探针对比

Lume 不是哪吒或 Komari 的全功能替代品，而是更聚焦线路质量与最小权限的精简方案。

| 维度 | Lume | 哪吒 | Komari |
| --- | --- | --- | --- |
| 核心定位 | 主机状态与少量显式网络/转发观测 | 服务器、网站监控与综合运维 | 实时主机监控与可扩展面板 |
| 后端 | Cloudflare Worker + D1，无需独立面板服务器 | 自托管 Dashboard | 自托管服务端 |
| Agent 通信 | 定时 HMAC/HTTPS 单向上报 | 出站 gRPC 长连接 | WebSocket，支持 POST 回退 |
| 被监测端口 | 不新增入站端口 | 通常不新增入站端口 | 通常不新增入站端口 |
| 远程能力 | 无远程命令、终端、文件管理或自动更新 | 可配置命令、终端、文件及 NAT 等任务 | 可配置远程命令与 Web SSH |
| 网络监测 | 配置驱动的 ICMP RTT/丢包、TCP 建连及 nftables 规则计数 | ICMP、TCP、HTTP 等服务监测 | Ping、任务与通用状态监测 |
| 告警方式 | Telegram 按需查询，不主动告警 | 完整通知与告警体系 | 通知、任务及管理功能 |
| 生态与平台 | Linux/systemd 优先，代码与依赖较少 | 平台覆盖和运维功能更丰富 | 多平台、主题与插件生态更丰富 |

选择 Lume，适合重视**线路延迟与丢包、无远程控制、低暴露面**的场景；需要秒级刷新、跨平台、复杂告警或远程运维时，哪吒和 Komari 更合适。参见[哪吒官方文档](https://nezha.wiki/)、[Komari 官方文档](https://komari-document.pages.dev/)。

## 安全边界

- Agent 不监听端口，只发起配置中明确声明的出站连接。
- `/etc/vpsmon/config.json` 是唯一执行清单：Agent 不生成隐藏探针，也不会探测未写入 `probes` 的目标；通信探针必须明确写为 `kind: "icmp"` 或 `kind: "tcp"`。
- Agent 以无特权用户运行；systemd 服务状态检查是只读的。
- TCP 使用普通出站 socket，无额外权限；仅在配置 nftables 计数时启用短时 oneshot，它只持有 `CAP_NET_ADMIN`，常驻 Agent 仍无 capability。
- 安装脚本只管理 `/opt/vpsmon`、`/etc/vpsmon`、`/var/lib/vpsmon` 及项目自己的 systemd units。
- Agent 成功升级后只保留最新 3 份校验过的回滚备份；清理器只匹配严格时间戳目录，不触碰其他状态文件。
- 系统不会自动切换线路，也不会修改 nftables、Xray 或其他业务配置。
- 密钥通过 Cloudflare Worker Secrets 和权限为 `0640` 或更严格的 VPS 配置文件保存。

完整说明见 [SECURITY.md](SECURITY.md)。

## 架构

```text
任意 VPS Agent ── HMAC/HTTPS ──> Cloudflare Worker ──> D1
      │                                  │               │
      ├── 基础主机指标                   ├── Telegram    ├── latest/history
      ├── 可选 systemd 服务              └── Dashboard   └── rollups/events
      ├── 可选 ICMP/TCP 通信探针
      └── 可选 nftables 数字计数快照
```

设计说明见 [docs/architecture.md](docs/architecture.md)，测量口径见 [docs/monitoring-methodology.md](docs/monitoring-methodology.md)，可选能力的配置与清理见[功能手册](docs/probes.md)，测试与可信发布流程见 [docs/testing-and-releases.md](docs/testing-and-releases.md)。

## 开始使用

首次部署优先使用上面的 `npm run setup`。管理工具保存可恢复的部署进度，并把私密状态放在被 Git 忽略的 `.lume/`；它不把 Bot Token 保存到本机，也不会在终端打印节点密钥。完整命令见[快速部署指南](docs/quickstart.md)。下面保留手工部署流程，供已有部署或需要逐步审计的人使用。

### 手工部署：从零到面板

1. 准备 Git、Node.js 22+、Cloudflare 账号、Telegram Bot 和至少一台 systemd Linux VPS。使用正式发布的 Agent 二进制时本机不需要 Go。
2. 创建后端：

   ```bash
   git clone https://github.com/MostlyCodex/lume-monitor.git
   cd lume-monitor/worker
   npm ci
   npx wrangler login
   npx wrangler d1 create lume
   ```

3. 将 `worker/wrangler.example.jsonc` 复制为被 Git 忽略的 `worker/wrangler.jsonc`，填写 Worker 名称、D1 `database_id` 和 Bot 用户名，然后执行：

   ```bash
   npx wrangler d1 migrations apply lume --remote
   npx wrangler deploy
   ```

   `DASHBOARD_BASE_URL` 只是兜底值：Worker 会在第 5 步的管理调用中记住自己的真实地址，所以这里填错也不需要重新部署。

4. 一次性提交全部 Secret。`wrangler secret bulk` 单次请求最多写入 100 个 Secret，而每个 `secret put` 都会产生一次新的 Worker 版本：

   ```bash
   node --input-type=module - <<'EOF' | npx wrangler secret bulk
   import { createHash, randomBytes } from "node:crypto";
   import { writeFileSync } from "node:fs";
   const hex = (bytes) => randomBytes(bytes).toString("hex");
   const bindCode = hex(24);
   const secrets = {
     NODE_KEYS: JSON.stringify({ "my-vps-01": hex(32) }),
     ADMIN_TOKEN: hex(32),
     TELEGRAM_WEBHOOK_SECRET: hex(32),
     TELEGRAM_BIND_CODE_HASH: createHash("sha256").update(bindCode).digest("hex"),
   };
   writeFileSync("lume-secrets.json", JSON.stringify({ ...secrets, TELEGRAM_BIND_CODE: bindCode }, null, 2), { mode: 0o600 });
   process.stderr.write("已写入 lume-secrets.json（权限 0600）；转存到密码管理器后请立即删除\n");
   process.stdout.write(JSON.stringify(secrets));
   EOF

   npx wrangler secret put TELEGRAM_BOT_TOKEN
   ```

   Cloudflare 不提供 Secret 明文回读，因此必须把 `lume-secrets.json` 中的完整 `NODE_KEYS` 映射、`ADMIN_TOKEN` 和一次性绑定码转存到密码管理器，随后删除该文件（它已被 `.gitignore` 排除）。Bot Token 单独交互写入，不经过任何脚本。

5. 让 Worker 记住自己的地址并配置 Telegram Webhook。同一个调用会同时完成两件事：

   ```bash
   curl -X POST "https://<worker>.<subdomain>.workers.dev/api/v1/admin/configure-telegram-webhook" \
     -H "Authorization: Bearer $ADMIN_TOKEN"
   ```

   只用 API、不需要面板时改为调用 `/api/v1/admin/dashboard-origin`。随后在 Bot 私聊中发送 `/bind <一次性绑定码>`，用 `/panel` 生成登录链接，不需要 Telegram 群组。详见[完整教程第 3 节](docs/getting-started.md#3-配置-telegram-和面板登录)。
6. 取得一次通用 Linux Agent。优先下载并校验正式发布的二进制，不需要本机安装 Go：

   ```bash
   sh deploy/fetch-release-agent.sh v1.3.0 /tmp/vpsmon-agent
   ```

   需要从当前源码自行构建时（此时才需要 Go 1.26+）：

   ```bash
   cd ../agent
   mkdir -p bin
   go test ./...
   CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath \
     -ldflags="-s -w -X main.version=1.3.0" \
     -o bin/vpsmon-agent-linux-amd64 ./cmd/vpsmon-agent
   cd ..
   ```

   ARM VPS 将 `GOARCH` 改为 `arm64`。Windows PowerShell 的对应命令见[完整教程第 4 节](docs/getting-started.md#4-编译通用-agent)。

7. 把 `deploy/config.example.json` 复制到仓库外的私密目录，至少修改 `node.id`、展示信息、Worker `endpoint` 和匹配的节点 `secret`。不需要附加监测时保持：

   ```json
   "services": [],
   "probes": [],
   "nftables_counters": []
   ```

   三项可选模块可在添加节点时配置，也可稍后运行 `npm run node:configure -- NODE_ID` 调整。字段、语义和干净下线方法见[功能手册](docs/probes.md)。

8. 按[完整教程第 6 节](docs/getting-started.md#6-安装首台-agent)将二进制、私密配置、systemd unit 和安装脚本放入 VPS 的 `/tmp/vpsmon-stage.<random>`，生成校验和并运行安装器。首份认证报告会自动创建面板目录，最后用 `/status`、`/panel` 验收。

### 以后增加一台 VPS

不需要改 Agent/Worker 源码，也不需要写 D1 migration：

```bash
cd worker

# 交互式
npm run node:add

# 一条命令，全部参数直接给出
npm run node:add -- --id hk-01 --name "HK 01" --role 中转 --region HK --ssh hk-01

# 一次加多台：清单里的所有节点共用一次 NODE_KEYS 提交
npm run node:add -- --from-file ../nodes.json
```

批量清单是 JSON 数组，每项至少包含 `id`：

```json
[
  {"id": "hk-01", "name": "HK 01", "role": "中转", "region": "HK", "ssh": "hk-01"},
  {"id": "sg-01", "name": "SG 01", "role": "落地", "region": "SG", "ssh": "sg-01"}
]
```

管理工具会维护并同步完整 `NODE_KEYS`、生成私密节点配置，并通过 SSH 安装已校验的 GitHub Release。已校验的二进制会按版本和架构缓存在 `.lume/cache/`，同架构的后续节点直接复用，不再重复下载；每次复用前都会重新核对 SHA-256，校验失败就丢弃缓存重新获取。安装过程使用 4 次 SSH 连接（读取架构并建目录、传输、安装、校验并清理），装完会轮询管理接口直到 Worker 收到首份认证上报，通常几秒内即可确认，而不是等满一个上报周期。

手工流程如下：

1. 选一个新的唯一节点 ID；
2. 生成新的独立密钥；
3. 在安全保存的完整 `NODE_KEYS` JSON 中追加它；
4. 用 `npx wrangler secret bulk` 提交**包含所有旧节点和新节点**的完整映射；
5. 再复制一份 `deploy/config.example.json`，填写新节点信息和新密钥；
6. CPU 架构相同就复用已有 Agent 二进制；
7. 用同一安装脚本部署；
8. 等待首份上报，节点会自动出现在 `/status` 和面板。

只提交新节点的局部 `NODE_KEYS` 会让所有旧节点失去认证能力。完整示例见[新增 VPS 指南](docs/getting-started.md#7-以后增加一台-vps)。

### 默认频率

- CPU、RAM、磁盘、流量和服务状态：每 60 秒采集并上报；
- 已配置的 ICMP/TCP 主动探测：模板默认每 60 秒执行；
- 已配置的 nftables 计数快照：每 60 秒读取一次；空配置时对应 timer 不启用；
- Worker 将每轮资源样本和整组探针结果分别压缩成单行时间序列，并继续兼容读取旧历史。当前约 5 台节点、十余个探针可按 60 秒运行在 D1 免费日额度内；扩容前仍应按节点数核算并观察 D1 Analytics，长期 30 秒不推荐。

采集频率与页面显示分辨率相互独立：

| 视图 | 时间范围 | Worker 返回时间桶 |
| --- | ---: | ---: |
| 首页全节点网络质量 | 最近 24 小时 | 5 分钟 |
| 单节点详情 | 6 小时、24 小时 | 1 分钟 |
| 单节点详情 | 7 天、30 天 | 1 小时 |
| 单节点详情 | 90 天 | 1 天 |

首页用 5 分钟数据桶控制多节点载荷，再将其合并成 18 个可见色块；进入节点详情后，6/24 小时曲线会保留每次 60 秒上报的分辨率。这里的显示聚合不会减少 Agent 探测次数，也不会改变 D1 原始数据保留期。

频率约束、流量公式和容量建议见[完整教程第 8 节](docs/getting-started.md#8-采集与探测频率)。

### 可选观测的执行清单与清理

- ICMP 显示在首页、详情和 Telegram `/status`；TCP 使用“建连失败率”且只在详情和按需状态中显示；
- nftables 计数只在配置它的节点详情中显示“转发活动”，空配置不会读取规则或产生后台任务；
- Agent 会按 `probe_interval_seconds` 执行配置中的**每一项**。如果某项已经没有使用场景，必须从节点配置删除，而不是只在前端隐藏。

仓库提供 `deploy/prune-probes.py` 生成不含指定探针的全新配置；它不覆盖源文件，可先校验再替换：

```bash
python3 prune-probes.py \
  --input /etc/vpsmon/config.json \
  --output /tmp/config.next.json \
  --remove OLD_PROBE_NAME

sudo /opt/vpsmon/vpsmon-agent --config /tmp/config.next.json --dry-run
```

可重复 `--remove` 一次删除多项。完成备份并安装新配置、仅重启 `vpsmon-agent` 后，下一份认证报告会自动把缺失探针和对应链路标为禁用。nftables 计数应从 `nftables_counters` 删除并通过升级器部署；数组变空时升级器会停用 timer 并删除数字快照。已有历史样本会按保留策略自然过期，不会继续发包或触发额外采集。完整步骤见[功能手册的干净停用章节](docs/probes.md#干净停用)。

## 下线节点

```bash
cd worker
npm run node:remove -- NODE_ID --ssh SSH别名          # 停用 Agent 并下线
npm run node:remove -- NODE_ID --ssh SSH别名 --uninstall   # 同时卸载 Agent
```

一条命令按顺序完成：停止并停用远端 Agent（`--uninstall` 时改为运行卸载脚本）、从完整 `NODE_KEYS` 中移除该节点密钥并重新提交、在 Worker 上标记退役、重写所有指向它的对端私密配置、清理本地私密文件。

### 退役是一个不会被覆盖的状态

`node_catalog.enabled` 由上报路径拥有：每份被接受的报告都会重新启用它仍然描述的行，这正是目录能够自愈的原因，但也意味着它无法表达运维意图。`retired_at` 由运维拥有，任何上报都不会设置或清除它。因此：

- 先改数据库还是先停 Agent 都可以，结果一致，命令也可以重复执行；
- 对端节点即使还在上报指向它的 `node-link` 探针，该探针和对应链路也不会被重新点亮；
- 已退役节点的历史样本、聚合和事件全部保留，按既有保留策略自然过期。

### 手工下线

需要逐条执行时使用管理接口，不必手写 SQL：

```bash
curl -X POST "https://<worker>.<subdomain>.workers.dev/api/v1/admin/nodes/NODE_ID/retire" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

它在一次 D1 批处理中停用该节点的目录项、服务、探针、计数器，以及**所有以它为目标**的探针与链路。恢复用 `/restore`；恢复只清除退役标记，服务、探针和链路由该节点的下一份上报重新注册。当前状态可用 `GET /api/v1/admin/nodes` 查看。

密钥仍需单独撤销，从完整映射中删除该节点后重新提交：

```bash
npx wrangler secret bulk   # 粘贴不含该节点的完整 NODE_KEYS
```

如果完整 `NODE_KEYS` 已经遗失、暂时无法安全重写，可把节点 ID 加入独立撤销列表，立即阻止旧密钥再次认证：

```bash
cd worker
npm run node:revoke -- NODE_ID          # 加入 REVOKED_NODE_IDS
npm run node:revoke -- NODE_ID --undo   # 恢复时先移除
```

撤销列表在查找节点 HMAC 密钥前生效。它是无法重写完整 `NODE_KEYS` 时的安全兜底；取得其余活动节点密钥后仍建议重写 `NODE_KEYS`，物理移除旧映射。

### 停止对端的无谓探测

Worker 会立即隐藏指向已退役节点的链路，但对端 Agent 在自己的配置更新前仍会继续发包。`node remove` 会自动重写受影响对端的私密配置并列出它们，随后按[升级流程](docs/deployment.md#9-upgrade-an-existing-agent)部署即可。

### 可选：卸载 Agent

确认不再恢复该节点后，`--uninstall` 会在 VPS 上运行 `deploy/uninstall-agent.sh`。它删除 Agent、配置、项目 systemd units 和 nftables 数字快照；保留 `vpsmon` 服务账号与报告 spool，避免不可逆地清除恢复资料。它不会修改 nftables 规则、Xray、SSH 或其他业务配置。

## 面板显示自定义

登录面板后点击顶部齿轮，可以修改面板名称、首页标题和副标题，也可以调整节点卡片顺序以及每个节点的显示名、角色标题、两位国家代码和城市/区域。保存后即时应用到首页、搜索和节点详情。

这些设置只写入当前浏览器的 `localStorage`：

- 不写入 D1，不改变 Agent 上报元数据；
- 不增加 API 请求或页面网络延迟；
- 不同浏览器和设备互不自动同步；
- 点击“恢复默认”即可重新使用服务端目录信息。

## 面板设计

首页采用状态头部、CPU/RAM/Disk 横向资源刻度、网络速率/累计流量以及逐目标的 24 小时延迟与丢包能量格。一个节点可以同时展示多条运营商探测和节点间链路，不会被压缩成单一平均值。资源刻度以连续长度表示当前占用，并在 70%/85% 标示关注与异常阈值；CPU/RAM/Disk 仅在首页展示，不在详情重复出现。详情页提供时间范围切换、可点选的目标图例以及延迟、失败事件和网络速率历史，其中 6/24 小时曲线按 1 分钟显示，7/30 天按小时显示，90 天按天显示。配置 TCP 时沿用相同图表但明确标为建连失败；配置 nftables 计数时才出现“转发活动”卡片和速率曲线。进入 6/24 小时详情时先用首页已加载的数据即时绘制，精细历史在后台替换并在当前会话缓存；系统不会预取所有节点。网络速率由相邻两次 Agent 上报的网卡累计字节差除以上报时间差计算，代表最近一个上报区间的平均速率，不是实时流式测速。

卡片指标右侧的数字表示最新一轮探测；下方 18 个能量棒色块表示最近 24 小时，每个色块约覆盖 80 分钟。历史丢包率按色块内实际 ICMP 尝试数和成功数加权，而不是直接平均百分比：不超过 2% 为绿色，超过 2% 至 10% 为黄色，超过 10% 为红色；若任一五分钟桶达到 60%，所在色块直接标红。最新一轮仍采用探针自身配置的失败率阈值，因此能及时显示刚发生但尚未显著影响长窗口平均值的异常。完整公式与设计依据见 [监测方法与技术实现](docs/monitoring-methodology.md#首页当前值与-24-小时能量棒)。

视觉层级参考了 [Komari Next](https://github.com/tonyliuzj/komari-next) 的节点卡片和 [Komari Theme Emerald](https://github.com/Tokinx/komari-theme-emerald) 的详情页组织方式；实现仍是项目自己的原生 HTML/CSS/JavaScript，并继续使用本地固定版本的 uPlot，不引入 React、Vue 或 ECharts 运行时。参考项目的许可信息见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 目录

| 路径 | 作用 |
| --- | --- |
| `agent/` | 通用 Linux Go Agent 与测试 |
| `worker/` | Cloudflare Worker、通用 D1 schema、动态面板和测试 |
| `deploy/` | 单一配置模板、安装/卸载脚本和 systemd unit |
| `tools/` | `lumectl` 首次部署、节点上线/下线、密钥与 Agent 安装管理 |
| `docs/` | 架构、探针和部署文档 |
| `scripts/` | 可重复的开发与性能验证脚本 |
| `package.json`（根） | 仅开发与测试工具链；部署 Worker 不需要安装 |

## 开发

```bash
cd agent
go test ./...

# 测试工具链在仓库根目录，Worker 目录只装 Wrangler
cd ..
npm ci
npx playwright install --with-deps chromium

cd worker
npm ci
npm run test:ci

# 使用完全虚构的数据预览面板，不需要 D1 或生产密钥
npm run preview:dashboard
```

`npm run test:ci` 会在临时目录中验证全新 D1、历史结构升级、真实本地 Worker HTTP 合约，并用 Playwright/Chromium 在 1440、1024、768 和 390 四种视口检查实际面板。全部使用虚构数据，不连接线上 Worker 或 D1。Linux Agent 性能基准及 GitHub Release 规则见[测试与发布文档](docs/testing-and-releases.md)。

## 发布策略

Git 提交和版本标签是唯一历史记录。构建缓存、ZIP 和本机交付副本不进入仓库；二进制发行物应附加到 GitHub Release。

## License

[MIT](LICENSE). Agent binary releases must also include [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
