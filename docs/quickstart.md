# 快速部署：十几分钟上线

这条路径面向第一次使用 Aegilume 的人。部署管理工具负责重复、易错的步骤；你仍会在执行前看到资源名称和影响范围，VPS 安装时也会看到 sudo 提示。

## 1. 准备

本机：

- Git、Node.js 22+、SSH/SCP；
- 可登录的 Cloudflare 账号；
- Telegram BotFather 创建的 Bot 用户名和 Token。

VPS：使用 systemd 的 Linux，支持 SSH，登录用户可运行 sudo。VPS 无需 Node.js、Go、Docker、数据库或 Web 服务；Agent 是一个只出站的静态二进制，不监听新端口。

## 2. 环境检查

```bash
git clone https://github.com/MostlyCodex/yuanshan-monitor.git
cd yuanshan-monitor/worker
npm ci
npm run doctor
```

五项均为 `✓` 后继续。Windows 用户可直接在 PowerShell 运行，不需要 WSL。

## 3. 部署后端

```bash
npm run setup
```

向导会：

1. 登录 Cloudflare；
2. 创建或绑定一个 D1 并应用全部 migrations；
3. 部署 Worker，自动识别最终 `workers.dev` 地址；
4. 生成并写入 `ADMIN_TOKEN`、完整 `NODE_KEYS` 和 Telegram Webhook Secrets；
5. 让 Wrangler 直接读取 Bot Token，本工具不保存或回显它；
6. 配置 Telegram Webhook 并检查 `/healthz`；
7. 询问是否立即添加首台 VPS。

中途关闭终端不会要求推倒重来；再次运行 `npm run setup` 会读取私有状态并继续。若仓库已有手工维护的 `worker/wrangler.jsonc` 而没有管理工具状态，向导会停止，避免覆盖现有部署。

## 4. 添加首台 VPS

如果在 setup 末尾选择继续，按提示填写即可。以后新增节点运行：

```bash
npm run node:add
```

基础节点只采集 CPU、RAM、磁盘、流量和主机状态。向导可附加只读 systemd unit 监测；ICMP 目标属于可选配置，字段与示例见[探针配置](probes.md)。

提供 SSH 别名后，工具会：

- 读取远端 CPU 架构；
- 下载与项目版本一致的 GitHub Release Agent；
- 按 Release 的 `SHA256SUMS` 验证二进制；
- 使用随机 `/tmp/vpsmon-stage.*` 目录传输文件；
- 调用仓库的保护性安装器，只创建独立 Agent 文件和服务；
- 验证 `vpsmon-agent.service` 为 `active`，随后删除本地和远端暂存目录。

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
| `npm run node:add` | 新建节点、同步完整密钥映射并可立即安装 |
| `npm run node:install -- ID --ssh ALIAS` | 安装已经创建但尚未部署的节点 |
| `npm run node:sync` | 从私有状态重新提交完整 `NODE_KEYS` |

## 私密状态与备份

`.yuanshan/state.json` 保存完整节点密钥映射、管理令牌和部署进度；`.yuanshan/nodes/` 保存各节点配置。整个 `.yuanshan/` 已被仓库根目录的 `.gitignore` 排除，工具不会打印密钥。在 Linux/macOS 上会同时设置 `0700/0600` 权限；Windows 继承当前目录 ACL，因此不要把仓库放在多用户共享目录。

Cloudflare 无法回读 Secret，因此部署完成后应把 `.yuanshan/state.json` 加密备份到密码管理器或其他可信介质。不要把 `.yuanshan/`、VPS 配置、终端里的 Token 或真实主机地址提交到 Git、Issue、论坛或聊天记录。

## 常见恢复

- `setup` 被中断：重新运行 `npm run setup`。
- 新节点未出现：等待 60 秒，再检查 `ssh ALIAS systemctl status vpsmon-agent.service`。
- 新增节点时 Worker 鉴权失败：运行 `npm run node:sync`，它会提交完整映射而非单个节点。
- 安装器提示目标已存在：说明 VPS 已有 Agent；不要强行覆盖，按[升级流程](deployment.md#9-upgrade-an-existing-agent)处理。
- 需要逐条执行或审计 Cloudflare 命令：改用[完整手工教程](getting-started.md)。
