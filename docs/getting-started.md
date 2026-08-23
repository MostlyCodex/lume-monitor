# 从零搭建远山Monitor

这是一份面向首次使用者的完整部署指南。完成后，你将拥有一个 Cloudflare Worker + D1 后端、一个 Telegram 私聊入口和至少一台持续上报的 Linux VPS。

> 所有示例 ID、域名和密钥都是占位符。生产密钥只应保存在密码管理器、Cloudflare Secrets 和 VPS 的 `/etc/vpsmon/config.json` 中，不要写入 Git、Issue、聊天记录或构建日志。

## 0. 准备清单

本机需要：

- Git；
- Node.js 22 或更新版本；
- Go 1.26 或更新版本；
- 可执行 `ssh`、`scp` 的终端；
- 一个可使用 Workers 和 D1 的 Cloudflare 账号。

被监控端需要：

- 使用 systemd 的 Linux VPS；
- 一个可使用 `sudo` 的 SSH 账号；
- 系统自带的 `systemctl`、`sha256sum`、`useradd`、`install` 等基础工具。

VPS 不需要安装 Node.js、Go、Docker、数据库、Web 服务或额外的 `ping` 程序。Agent 是单个静态 Go 二进制，只建立出站连接，不监听端口。

克隆项目：

```bash
git clone https://github.com/MostlyCodex/yuanshan-monitor.git
cd yuanshan-monitor
```

## 1. 创建 Cloudflare Worker 和 D1

进入 Worker 目录并登录：

```bash
cd worker
npm ci
npx wrangler login
npx wrangler d1 create yuanshan-monitor
```

复制生产配置模板：

```powershell
# Windows PowerShell
Copy-Item wrangler.example.jsonc wrangler.jsonc
```

```bash
# Linux / macOS
cp wrangler.example.jsonc wrangler.jsonc
```

编辑不会提交到 Git 的 `worker/wrangler.jsonc`：

1. `name`：改成你自己的唯一 Worker 名称；
2. `database_id`：填入 `wrangler d1 create` 返回的 ID；
3. `database_name`：与刚创建的 D1 名称保持一致；
4. `DASHBOARD_BASE_URL`：填最终的 `https://<worker>.<subdomain>.workers.dev`；
5. `TELEGRAM_BOT_USERNAME`：填 Bot 用户名，可不带 `@`。

应用数据库迁移并首次部署：

```bash
npx wrangler d1 migrations apply yuanshan-monitor --remote
npm run check
npm run deploy
```

部署结果会显示真实 Worker URL。如果它与 `DASHBOARD_BASE_URL` 不同，修正配置并再次执行 `npm run deploy`。随后验证：

```bash
curl https://<worker>.<subdomain>.workers.dev/healthz
```

应返回包含 `"ok":true` 的 JSON。

## 2. 创建第一个节点密钥

每台 VPS 都需要一个稳定节点 ID 和一个互不复用的随机密钥。节点 ID 只允许小写字母、数字、`_`、`-`，最长 32 个字符，例如 `my-vps-01`。

生成两个随机值：一个作为首台 VPS 的密钥，一个作为管理令牌。

```powershell
# Windows PowerShell
[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLower()
[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLower()
```

```bash
# Linux / macOS
openssl rand -hex 32
openssl rand -hex 32
```

将节点 ID 与第一个随机值组成一行完整 JSON，并安全保存：

```json
{"my-vps-01":"<NODE_SECRET_1>"}
```

交互式写入 Cloudflare Secrets：

```bash
npx wrangler secret put NODE_KEYS
npx wrangler secret put ADMIN_TOKEN
```

- 在 `NODE_KEYS` 提示中粘贴完整 JSON；
- 在 `ADMIN_TOKEN` 提示中粘贴第二个随机值；
- Cloudflare 不提供 Secret 明文回读，因此必须在密码管理器中保留 **完整 `NODE_KEYS` 映射**。

## 3. 配置 Telegram 和面板登录

只使用 API 时可以跳过本节；要使用内置网页面板，就需要 Telegram Bot 生成一次性登录链接。

1. 在 BotFather 中创建 Bot，并取得 Bot Token；
2. 准备一个至少 32 字符的 Webhook Secret；
3. 准备一个一次性绑定码，并计算其 SHA-256。

PowerShell 示例：

```powershell
$bindCode = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24)).ToLower()
$bindHash = [Convert]::ToHexString(
  [Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($bindCode))
).ToLower()
$bindCode
$bindHash
```

Linux / macOS 示例：

```bash
BIND_CODE="$(openssl rand -hex 24)"
printf '%s\n' "$BIND_CODE"
printf '%s' "$BIND_CODE" | sha256sum
```

依次写入三个 Secret；`TELEGRAM_BIND_CODE_HASH` 填哈希，不填绑定码明文：

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put TELEGRAM_BIND_CODE_HASH
```

调用一次 Webhook 配置接口。PowerShell：

```powershell
$workerUrl = "https://<worker>.<subdomain>.workers.dev"
$adminToken = Read-Host "ADMIN_TOKEN"
Invoke-RestMethod -Method Post `
  -Uri "$workerUrl/api/v1/admin/configure-telegram-webhook" `
  -Headers @{ Authorization = "Bearer $adminToken" }
Remove-Variable adminToken
```

Linux / macOS：

```bash
read -rsp 'ADMIN_TOKEN: ' ADMIN_TOKEN; echo
curl -X POST "https://<worker>.<subdomain>.workers.dev/api/v1/admin/configure-telegram-webhook" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
unset ADMIN_TOKEN
```

最后在与 Bot 的**私聊**中发送：

```text
/bind <刚才的一次性绑定码>
```

绑定成功后立即从临时记录中删除绑定码。此后可使用：

- `/status`（查看实时状态）：按节点分组展示在线情况、最近上报时间、资源、服务以及各条线路的延迟和丢包；
- `/panel`（打开监控面板）：生成 5 分钟内有效、仅可使用一次的面板登录链接；
- `/help`（查看命令说明）：查看机器人命令说明。

不需要建立 Telegram 群组。

## 4. 编译通用 Agent

正式标签版本也可以直接下载并验证对应架构的发布二进制，不需要在本机安装 Go：

```bash
sh deploy/fetch-release-agent.sh v1.0.1 /tmp/vpsmon-agent
/tmp/vpsmon-agent --version
```

下载器只获取指定版本并核验 SHA-256，不会安装、覆盖或重启任何 VPS。发布来源证明及完整规则见 [testing-and-releases.md](testing-and-releases.md)。如果使用当前源码自行构建，再继续下面的步骤。

先在 VPS 上运行 `uname -m`：

- `x86_64` 对应 `GOARCH=amd64`；
- `aarch64` 或 `arm64` 对应 `GOARCH=arm64`。

PowerShell 交叉编译 Linux amd64：

```powershell
Set-Location ..\agent
New-Item -ItemType Directory -Force bin | Out-Null
$env:CGO_ENABLED = "0"
$env:GOOS = "linux"
$env:GOARCH = "amd64"
go test ./...
go build -trimpath -ldflags="-s -w -X main.version=1.0.0" -o bin/vpsmon-agent-linux-amd64 ./cmd/vpsmon-agent
Remove-Item Env:CGO_ENABLED, Env:GOOS, Env:GOARCH
Set-Location ..
```

Linux / macOS：

```bash
cd agent
mkdir -p bin
go test ./...
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
  go build -trimpath -ldflags="-s -w -X main.version=1.0.0" \
  -o bin/vpsmon-agent-linux-amd64 ./cmd/vpsmon-agent
cd ..
```

同一 CPU 架构的所有 VPS 可以复用同一二进制，无需为不同节点修改或重新编译源码。

## 5. 创建首台 VPS 配置

将模板复制到仓库外的私密目录，并命名为 `config.json`：

```powershell
# 示例；也可以使用密码管理器或其他受控目录
New-Item -ItemType Directory -Force "$env:USERPROFILE\vpsmon-private\my-vps-01" | Out-Null
Copy-Item deploy/config.example.json "$env:USERPROFILE\vpsmon-private\my-vps-01\config.json"
```

至少修改：

- `node.id`：`my-vps-01`，必须与 `NODE_KEYS` 中的键一致；
- `node.display_name`、`role`、`region` 等展示信息；
- `endpoint`：真实 Worker URL 加 `/api/v1/report`；
- `secret`：该节点对应的独立密钥。

只监测 CPU、RAM、磁盘、流量等基础指标时保持：

```json
"services": [],
"probes": []
```

要只读监测 systemd 服务，可加入：

```json
"services": [
  {"name":"example.service","label":"Example","severity":"P1"}
]
```

要监测节点间或外部参考目标，复制 [probes.md](probes.md) 中的 ICMP 示例。它们只是附加层，不会改变基础 Agent 模板，但配置中的每个探针都会按周期真实执行。不再需要时，请按[删除无用探针](probes.md#removing-an-unused-probe)流程从节点配置移除。

## 6. 安装首台 Agent

下面使用 `/tmp/vpsmon-stage.a1b2c3` 作为一次性目录。把 `<ssh-user>@<vps-host>` 替换为自己的 SSH 目标；目录后缀应换成随机值。

```bash
ssh <ssh-user>@<vps-host> "install -d -m 0700 /tmp/vpsmon-stage.a1b2c3"
scp agent/bin/vpsmon-agent-linux-amd64 <ssh-user>@<vps-host>:/tmp/vpsmon-stage.a1b2c3/vpsmon-agent
scp /private/path/config.json <ssh-user>@<vps-host>:/tmp/vpsmon-stage.a1b2c3/config.json
scp deploy/vpsmon-agent.service deploy/install-agent.sh <ssh-user>@<vps-host>:/tmp/vpsmon-stage.a1b2c3/
ssh <ssh-user>@<vps-host> "cd /tmp/vpsmon-stage.a1b2c3 && sha256sum vpsmon-agent config.json vpsmon-agent.service > checksums.sha256 && sudo sh ./install-agent.sh /tmp/vpsmon-stage.a1b2c3"
```

安装器只管理自己的 Agent 文件和 systemd unit。它会先验证校验和与配置、记录被监测服务状态，失败时只回滚监控自身，不会修改或重启被监测服务。

验证：

```bash
ssh <ssh-user>@<vps-host> "systemctl is-active vpsmon-agent.service && sudo journalctl -u vpsmon-agent.service --since '10 minutes ago' --no-pager"
```

应看到服务为 `active` 且上报成功。第一份通过 HMAC 认证的报告会自动注册节点；无需改 Worker 源码、数据库迁移或面板代码。此时在 Telegram 发送 `/status` 和 `/panel` 验收。

## 7. 以后增加一台 VPS

新增节点不需要改源码。严格按以下顺序操作：

1. 选择新的唯一 ID，例如 `my-vps-02`；
2. 生成一个新的独立随机密钥；
3. 在密码管理器中把它加入原有完整映射；
4. 再次执行 `npx wrangler secret put NODE_KEYS`，粘贴包含**所有旧节点和新节点**的完整 JSON；
5. 再复制一次 `deploy/config.example.json`，填写新 ID、展示信息、同一 Worker endpoint 和新密钥；
6. CPU 架构相同则直接复用已有 Agent 二进制；
7. 按第 6 节上传并安装；
8. 等待首次上报后用 `/status` 和面板确认。

例如原有映射：

```json
{"my-vps-01":"<NODE_SECRET_1>"}
```

新增后必须整体更新为：

```json
{"my-vps-01":"<NODE_SECRET_1>","my-vps-02":"<NODE_SECRET_2>"}
```

不能只提交 `my-vps-02` 的局部 JSON，否则旧节点会立刻失去认证能力。

## 8. 采集与探测频率

两个频率互相独立：

| 配置 | 含义 | 模板默认值 |
| --- | --- | ---: |
| `report_interval_seconds` | 采集资源、服务状态并上报最新值 | 60 秒 |
| `probe_interval_seconds` | 真正执行 ICMP 主动探测 | 60 秒 |

所以默认状态下，CPU/RAM/Disk 和网络质量都按分钟更新。ICMP 默认每个目标发送 5 个 Echo；一次探测仍只形成该节点这一轮的一条紧凑 D1 记录，不会按目标拆成多行。

约束：上报间隔为 30–600 秒；探测间隔不得短于上报间隔，且不得超过 3600 秒。

页面不会把所有时间范围都强行返回成相同密度。默认 API 时间桶为：

| 视图 | 范围 | Worker 返回时间桶 |
| --- | ---: | ---: |
| 首页全节点历史 | 24 小时 | 5 分钟 |
| 单节点详情 | 6 小时、24 小时 | 1 分钟 |
| 单节点详情 | 7 天、30 天 | 1 小时 |
| 单节点详情 | 90 天 | 1 天 |

因此“每 60 秒上报”与“首页 API 按 5 分钟返回”并不冲突：前者是采集频率，后者只是全节点视图的传输聚合。首页再将这些五分钟桶合并成 18 个可见能量棒色块，每个色块约覆盖 80 分钟；进入单节点详情后，短周期历史按一分钟点位返回。所有视图都读取持续采集的数据，`/status` 和 `/panel` 不会临时发起探测。

建议：

- 约 5 台节点、十余个探针：保持 60 秒默认值，并在运行 24 小时后核对 D1 Analytics；
- 免费计划扩容前：按下式重新核算，建议将日写入控制在 8 万以内，为目录变化、事件和迁移保留余量；
- 若接近预算：先将 `probe_interval_seconds` 调为 120 或 180 秒；仍不足时再同步提高 `report_interval_seconds`；
- 30 秒虽然是技术下限，但会同时加倍 Worker 请求、资源样本和数据库写入，不建议作为长期默认值。

当前存储会将资源样本和整轮探针分别写成一行，并使用时间开头的 `WITHOUT ROWID` 主键。旧表只读兼容至历史自然过期，不进行高成本回填。保守估算免费额度：

```text
R = 86400 ÷ report_interval_seconds
N = 在线节点数
Q = 至少配置一个探针的节点数
P = 全部节点的探针总数

每日稳态写入约为：
  R × (4N + 2Q)       # 最新状态、资源历史、探针轮次及30天后的删除
  + 1512N + 216P      # 重叠窗口的小时聚合（保守按索引写入计）
  + 3 × (7N + P)      # 日聚合

示例 N=5、Q=4、P=21、R=1440：约 52,584 行/日；
计入偶发目录和事件写入后，按约 5.5–6.5 万行/日规划。

每日探测轮数 = P × 86400 ÷ probe_interval_seconds
每日 ICMP Echo 数 = ICMP 探测轮数 × samples
```

D1 按实际读写行计量，索引更新和删除也会计入写入。公式是容量规划上界，不替代账单数据；运行满 24 小时后应查看 Cloudflare D1 Analytics。当前免费额度和数据库尺寸限制以 [Cloudflare D1 官方定价](https://developers.cloudflare.com/d1/platform/pricing/) 为准。

## 9. 常见问题

### Agent 返回 401

`node.id` 不在 `NODE_KEYS` 中，或节点配置的 `secret` 与该 ID 对应值不一致。重新核对完整映射，不要生成第二套同名节点密钥。

### Agent 无法读取配置

生产配置应为 root 所有、`vpsmon` 组可读，权限 `0640` 或更严格。使用安装脚本会自动设置。

### ICMP 全部失败

目标可能屏蔽或限制 ICMP，或者 Linux 未允许 `vpsmon` 组使用无特权 ping socket。检查：

```bash
id vpsmon
cat /proc/sys/net/ipv4/ping_group_range
```

不要为此给 Agent root、`CAP_NET_RAW` 或额外开放端口。详见 [deployment.md](deployment.md)。

### Bot 没有响应

确认是在已绑定账号的私聊中发送命令，并重新调用 Webhook 配置接口。`/bind` 只在尚未绑定所有者时生效。

### 新节点没有出现在面板

先检查 `systemctl is-active vpsmon-agent.service` 和 Agent 日志；只要首份报告被 Worker 接受，目录就会自动生成。无需手工插入 D1。

## 下一步

- 配置可选探针：[probes.md](probes.md)
- 安全升级与回滚：[deployment.md](deployment.md)
- 技术架构：[architecture.md](architecture.md)
- 测量口径：[monitoring-methodology.md](monitoring-methodology.md)
- 安全边界：[../SECURITY.md](../SECURITY.md)
