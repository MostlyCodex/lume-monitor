# 部署与管理

所有命令都在本机仓库的 `worker/` 目录运行。第一次部署和以后的节点管理共用一个入口：

```bash
npm run manage
```

按编号选择操作，再按提示填写。节点 ID 是监控系统里的唯一标识；SSH 别名是本机连接 VPS 的名称，两者可以不同。

## 准备

- 本机：Git、Node.js 22+、SSH/SCP；Windows 可直接用 PowerShell。
- VPS：systemd Linux，支持 amd64 或 arm64，SSH 用户能运行 sudo。
- Cloudflare 账号和 Telegram Bot 的用户名、Token。

```bash
git clone https://github.com/MostlyCodex/lume-monitor.git
cd lume-monitor/worker
npm ci
npm run doctor
npm run manage
```

使用发布的 Agent 时，本机和 VPS 都不需要 Go。复杂 SSH 端口、私钥和跳板机写入本机 SSH 配置，然后确认 `ssh 你的别名` 能登录。

## 从零部署

在菜单选择“从零部署”，也可以直接运行：

```bash
npm run setup
```

向导依次处理 Cloudflare 登录、D1、数据库迁移、Worker、密钥和 Telegram。按提示安装首台 VPS，然后私聊 Bot 发送工具给出的 `/bind ...`，再发送 `/panel` 打开面板。

完成标准：工具确认 Worker 已接受首份上报，且 `/status` 和面板能看到节点。

部署中断后可再次运行同一命令。登录授权、Bot Token 和 sudo 密码需要你在提示中输入。

## 接管已经上线的部署

如果线上正常，但本机提示“未找到本地部署管理状态”，选择“接管已有部署”：

```bash
npm run setup:adopt
```

准备现有 `worker/wrangler.jsonc`、Worker 地址和 `ADMIN_TOKEN`。向导从 SSH 或本地 Agent 配置文件读取每个节点的现有配置，并与线上完整密钥清单逐一核对，随后保存 `.lume/`。密钥和管理令牌不会打印到终端。

SSH 读取配置需要 root 或免密码 sudo；不具备该条件时选择本地配置文件。使用同一 Worker 的其他域名时，应填写节点配置实际使用的地址。

接管会通过 Cloudflare 登录检查并应用现有 D1 的待执行迁移，再读取节点目录。旧版本 Worker 缺少接管接口时，向导会询问是否更新；先完成数据库迁移，再部署代码，保留现有 D1 和 Secrets。中断后可重试，已完成的迁移不会重复执行。

清单包含已经登记但尚未上报的密钥；必须全部核对完成才能接管。密钥不一致或接管期间线上发生变化时会停止，不会覆盖其他节点。重新接管已有本地状态时，先自动保存备份。

## 新增 VPS

选择“新增 VPS”，填写节点信息，再配置 systemd 服务、网络质量监测、nftables 计数器和 SSH 别名：

```bash
npm run node:add
```

工具自动生成独立密钥，同步完整密钥映射，下载并校验对应架构的 Agent，安装后等待新的认证上报。VPS 无需开放额外入站端口。

网络质量有四个明确选项：**三网 ICMP 向导、复用已有节点的外部探针、自定义 ICMP/TCP、暂不配置**。已有节点配置过三网时，选“复用”，选择来源节点和探针即可。首台节点可在三网向导填写电信、联通、移动各一个参考目标；工具不内置未经确认的运营商 IP。向导会展示完整监测摘要，确认后直接部署；需要 sudo 密码时，在同一终端的 SSH 提示中输入。

暂不安装时可以留空 SSH 目标。稍后运行 `npm run node:install`，从列表选择节点。自动化调用也可以直接传入参数：

```bash
npm run node:add -- --id hk-01 --name "Hong Kong" --region HK --ssh my-hk-vps
```

批量增加：`npm run node:add -- --from-file ../nodes.json`。清单为 JSON 数组，每项包含 `id`，以及可选的 `name`、`role`、`region`、`ssh`、`services`、`probes` 和 `nftables_counters`。

## 配置监测项

选择“配置节点”，或运行：

```bash
npm run node:configure
```

选择节点后，systemd 服务、网络探针和 nftables 计数器分别配置。网络探针选择“追加”或“重新配置”后，进入同样的三网、复用和自定义向导。复用会展示实际目标供选择，不复制节点密钥或节点间探针。

确认摘要后，向导自动备份、保存并询问是否立即部署。即使配置没有再次修改，只要存在待部署项，也能在当前向导继续下发。三个可选列表为空时，仅采集主机资源。

每项输入都会显示可选值、格式或数量上限。填错、重名、越界时，只提示重填当前项，保留此前输入；“是／否”只接受提示中列出的答案。显示名、用途和地区可自定义，仍须符合标明的长度限制。

| 观测 | 向导中填写 | 含义 |
| --- | --- | --- |
| systemd | VPS 的实际服务名，如 `nginx.service`；最多 16 个，每项 1–80 位字母、数字或 `_.@-` | 只读服务运行状态 |
| ICMP | IPv4、IPv6 或主机名；不带协议、端口或路径 | 网络层延迟与 Echo 丢包 |
| TCP | 同上，另填 `1–65535` 的整数端口；ICMP/TCP 合计最多 32 个 | 建连延迟与建连失败率 |
| nftables | family 选 `ip/ip6/inet`，协议选 `tcp/udp`，端口 `1–65535`；实际 table/chain 名为 1–64 位字母、数字或 `_.-`；comment 最多 80 字节；最多 16 项 | 已有规则的命中增量；不创建或修改规则 |

节点间探针写在**发起探测的源节点**，目标节点 ID 只能从列出的其他活动节点中选择。外部参考目标留空。需要双向观测时，在两端分别配置。

ICMP 丢包和 TCP 建连失败含义不同，目标过滤 ICMP 也可能导致探测失败。[测量口径](reference/monitoring-methodology.md)说明指标定义和限制。

三网图表反映 VPS 到所选三个参考目标的延迟和丢包，历史从启用后积累。nftables 是否启用不影响三网探测。

## 部署配置与更新 Agent

选择“部署配置 / 更新 Agent”，或运行 `npm run node:apply`。工具上传当前本地配置和项目版本的 Agent，检查配置、备份现有文件，再更新。失败时由升级脚本回滚监控自身；运行中的业务服务不参与更新。

停止状态的 Agent 在普通更新后仍保持停止。恢复退役节点请使用下一节的恢复操作。

复杂配置也可直接编辑 `.lume/nodes/节点ID/config.json`，再选择此操作下发。部署中断或对端不可达时，状态会保留为“配置待部署”，修复连接后重试：

```bash
npm run node:apply -- --pending
```

默认每 60 秒采集并上报。可在节点配置中调整 `report_interval_seconds` 和 `probe_interval_seconds`；新增节点和提高频率都会增加 D1 用量，按实际 D1 Analytics 评估。

## 下线和恢复

选择“下线节点”或“下线并卸载 Agent”：

```bash
npm run node:remove
```

工具停用目标 Agent、撤销密钥、在 Worker 标记退役，并自动更新和部署所有已登记对端的相关探针配置。下线的是监控节点，不会关闭 VPS。历史数据按既有保留策略处理。

追加 `--uninstall` 会同时移除 Agent、项目服务和远端配置；保留服务账号和报告暂存数据。本地配置和原来的节点间探针保存在 `.lume/retired/`，用于恢复。

恢复时选择“恢复节点”，或运行：

```bash
npm run node:restore
```

工具轮换密钥、处理撤销记录、重新部署并启动 Agent，收到新的上报后解除退役，并恢复原来的节点间探针。若没有保存该节点配置，向导也支持重新填写。若某个探针名称已被其他配置复用，会提示冲突并停止覆盖。

下线或恢复中断后重试同一操作。目标已退役但对端更新失败时，再次运行下线操作会继续处理对端。

## 状态与备份

`npm run monitor:status` 显示已登记节点、最近上报、待部署和恢复状态。“未找到本地部署管理状态”只表示缺少 `.lume/state.json`，不能据此判断线上服务是否正常。

完整备份 `.lume/` 和 `worker/wrangler.jsonc`；它们已被 Git 忽略。前者包含密钥、令牌、节点配置与恢复记录，应加密保存。更换管理电脑时恢复这些文件，并配置 SSH 登录。

Cloudflare 无法回读密钥明文。不要用只含新节点的 `NODE_KEYS` 覆盖完整映射，也不要同时从多份不一致的管理状态修改节点。工具会在写入前核对线上清单，发现变化时要求重新接管。

## 常见问题

| 情况 | 处理 |
| --- | --- |
| Agent 已运行，面板没有新数据 | 在 VPS 运行 `sudo journalctl -u vpsmon-agent.service -n 30 --no-pager`，检查上报错误 |
| HTTP 401 | 核对节点 ID、密钥、撤销记录和 VPS 系统时间 |
| 提示线上密钥清单变化 | 停止使用旧状态，运行接管向导核对所有现有节点 |
| 接管提示无法读取节点目录 | 更新本地代码后重试接管，让向导补齐数据库迁移；仍失败时按 HTTP 状态检查令牌、D1 绑定和 Worker 日志 |
| 下载 Release 失败 | 检查 GitHub 连接；本机有 Go 1.26+ 时工具可从源码构建，校验不一致则直接停止 |
| 安装目标已经存在 | 选择“部署配置 / 更新 Agent”；退役节点选择“恢复节点” |
| 对端 SSH 不可达 | 恢复连接后重试下线/恢复，或部署待处理配置 |

## 公开演示

[在线演示](https://mostlycodex.github.io/lume-monitor/)使用虚构数据，可以直接分享给访客。自己的 Worker 更新后，也可通过 `/demo/` 打开同样的演示；私有面板和数据 API 仍需认证。
