# 快速部署：十几分钟上线

这条路径面向第一次使用 Lume 的人。部署管理工具负责重复、易错的步骤；你仍会在执行前看到资源名称和影响范围，VPS 安装时也会看到 sudo 提示。

## 1. 准备

本机：

- Git、Node.js 22+、SSH/SCP（不需要 Go）；
- 可登录的 Cloudflare 账号；
- Telegram BotFather 创建的 Bot 用户名和 Token。

VPS：使用 systemd 的 Linux，支持 SSH，登录用户可运行 sudo。VPS 无需 Node.js、Go、Docker、数据库或 Web 服务；Agent 是一个只出站的静态二进制，不监听新端口。

## 2. 环境检查

```bash
git clone https://github.com/MostlyCodex/lume-monitor.git
cd lume-monitor/worker
npm ci
npm run doctor
```

五项均为 `✓` 后继续。Windows 用户可直接在 PowerShell 运行，不需要 WSL。

`worker/` 只依赖 Wrangler。TypeScript、Vitest 和 Playwright 在仓库根目录的独立 `package.json` 中，只有开发和跑测试才需要安装。

## 3. 部署后端

```bash
npm run setup
```

向导会：

1. 登录 Cloudflare；
2. 创建或绑定一个 D1 并应用全部 migrations；
3. **部署一次** Worker，并自动识别最终 `workers.dev` 地址；
4. 用一次 `wrangler secret bulk` 写入 `ADMIN_TOKEN`、完整 `NODE_KEYS` 和 Telegram Webhook Secrets；
5. 让 Wrangler 直接读取 Bot Token，本工具不保存或回显它；
6. 通过一次带鉴权的管理调用让 Worker 记住自己的公开地址；
7. 配置 Telegram Webhook 并检查 `/healthz`；
8. 询问是否立即添加首台 VPS。

第 3 步与第 6 步替代了旧流程中“部署 → 读回 URL → 再部署一次”的两次部署；第 4 步替代了逐个 `secret put`，后者每写一个 Secret 都会产生一个新的 Worker 版本。

中途关闭终端不会要求推倒重来；再次运行 `npm run setup` 会读取私有状态并继续。若仓库已有手工维护的 `worker/wrangler.jsonc` 而没有管理工具状态，向导会停止，避免覆盖现有部署。

## 4. 添加首台 VPS

如果在 setup 末尾选择继续，按提示填写即可。以后新增节点运行：

```bash
# 交互式
npm run node:add

# 非交互：一条命令建号并安装
npm run node:add -- --id hk-01 --name "HK 01" --role 中转 --region HK --ssh hk-01

# 批量：清单内所有节点共用一次 NODE_KEYS 提交
npm run node:add -- --from-file ../nodes.json
```

基础节点只采集 CPU、RAM、磁盘、流量和主机状态。向导可附加只读 systemd unit、TCP 和 nftables 规则计数；ICMP 可按功能手册加入同一通用配置。所有可选数组均可保持为空而完全不运行。字段、适用场景和权限边界见[功能手册](probes.md)。

提供 SSH 别名后，工具会：

- 在同一次 SSH 连接中读取远端 CPU 架构，并创建权限 0700 的随机 `/tmp/vpsmon-stage.*` 目录；
- 下载与项目版本一致的 GitHub Release Agent，按 Release 的 `SHA256SUMS` 验证；
- 把校验通过的二进制缓存到 `.lume/cache/`，同版本同架构的后续节点直接复用；每次复用前重新核对 SHA-256，不匹配就丢弃缓存重新获取；
- 传输文件后调用仓库的保护性安装器，只创建独立 Agent 文件和服务；
- 验证 `vpsmon-agent.service` 为 `active`，同时删除本地和远端暂存目录；
- 轮询管理接口直到 Worker 收到首份认证上报，再报告“已上线”。

整个安装使用 4 次 SSH 连接。Agent 在启动定时器之前就会发出第一份报告，所以确认通常在几秒内完成，不需要等满一个上报周期。

如果相同版本的 Release 暂时不可用，工具只会在本机已有 Go 1.26+ 时从当前源码交叉编译；校验和不匹配时则直接停止，不会用源码构建掩盖完整性异常。

未立即安装时可稍后执行：

```bash
npm run node:install -- NODE_ID --ssh SSH_ALIAS
```

复杂端口、跳板机或私钥路径请先写入 `~/.ssh/config`，命令中只传 SSH 别名。

## 5. 打开面板

部署结束时会显示一次性绑定命令：

```text
/bind <一次性绑定码>
```

私聊 Bot 发送它，绑定成功后发送 `/panel`。`/status` 查看当前状态，`/help` 查看命令说明。项目不要求私密群组，也不会主动发送告警或日报。

## 日常命令

在 `worker/` 目录运行：

| 命令 | 用途 |
| --- | --- |
| `npm run doctor` | 检查本机部署依赖 |
| `npm run monitor:status` | 显示后端、节点和在线健康检查，不显示密钥 |
| `npm run node:add` | 新建节点、同步完整密钥映射并可立即安装；支持 `--id/--ssh` 与 `--from-file` |
| `npm run node:configure -- ID` | 修改该节点的可选 ICMP/TCP/nftables 观测配置 |
| `npm run node:install -- ID --ssh ALIAS` | 安装已经创建但尚未部署的节点 |
| `npm run node:remove -- ID --ssh ALIAS` | 下线：停用 Agent、撤销密钥、标记退役并清理对端配置 |
| `npm run node:revoke -- ID` | 完整密钥映射丢失时的应急撤销（`--undo` 恢复） |
| `npm run node:sync` | 从私有状态重新提交完整 `NODE_KEYS` |

## 私密状态与备份

`.lume/state.json` 保存完整节点密钥映射、管理令牌和部署进度；`.lume/nodes/` 保存各节点配置。整个 `.lume/` 已被仓库根目录的 `.gitignore` 排除，工具不会打印密钥。在 Linux/macOS 上会同时设置 `0700/0600` 权限；Windows 继承当前目录 ACL，因此不要把仓库放在多用户共享目录。

Cloudflare 无法回读 Secret，因此部署完成后应把 `.lume/state.json` 加密备份到密码管理器或其他可信介质。不要把 `.lume/`、VPS 配置、终端里的 Token 或真实主机地址提交到 Git、Issue、论坛或聊天记录。

## 常见恢复

- `setup` 被中断：重新运行 `npm run setup`。
- 新节点未出现：`node:add` 与 `node:install` 已经等待过首份上报；若它提示尚未收到，直接查看 `ssh ALIAS journalctl -u vpsmon-agent.service -n 30 --no-pager`。
- 新增节点时 Worker 鉴权失败：运行 `npm run node:sync`，它会提交完整映射而非单个节点。
- 安装器提示目标已存在：说明 VPS 已有 Agent；不要强行覆盖，按[升级流程](deployment.md#9-upgrade-an-existing-agent)处理。
- 修改已有节点可选观测：运行 `npm run node:configure -- ID` 生成候选私密配置，再按[升级流程](deployment.md#9-upgrade-an-existing-agent)部署；该命令不会静默连接 VPS。
- 需要下线节点：`npm run node:remove -- ID --ssh ALIAS`；退役标记不会被后续上报覆盖，因此顺序无关且可重复执行。
- 需要逐条执行或审计 Cloudflare 命令：改用[完整手工教程](getting-started.md)。
