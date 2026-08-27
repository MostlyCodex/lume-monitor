# 功能手册：可选观测

Lume 的基础主机监控始终启用；`services`、`probes` 和
`nftables_counters` 是三个独立的可选模块。空数组表示完全不运行该模块。

| 模块 | 解决的问题 | 是否产生网络流量 | 首页展示 |
| --- | --- | --- | --- |
| systemd 服务 | 指定服务是否仍在运行 | 否 | 只影响节点健康，详情显示 |
| ICMP | 网络层 RTT 与 Echo 丢包 | 是，少量 ICMP Echo | 是 |
| TCP 可达性 | 指定主机端口能否建立 TCP 连接 | 是，短连接后立即关闭 | 否；详情显示并影响健康 |
| nftables 计数 | 指定规则在区间内新增多少次命中 | 否，只读本机内核计数 | 否；详情显示 |

`/etc/vpsmon/config.json` 是唯一执行清单。Agent 不从 Worker 接收远程任务，
也不会生成隐藏检查。只有写入配置的项目才会运行；从配置删除后，下一份
报告会停用对应目录和页面模块。

## 用部署工具配置

添加新节点时，`npm run node:add` 会询问是否配置可选观测。跳过后仍是完整
可用的纯主机监控节点。已有但尚未部署的节点可以重新配置：

```bash
cd worker
npm run node:configure -- NODE_ID
```

该命令只改 Git 忽略的 `.lume/nodes/NODE_ID/config.json`，不会静默连接或
修改运行中的 VPS。已安装节点应按[安全升级流程](deployment.md#9-upgrade-an-existing-agent)
部署候选配置；新节点直接执行 `npm run node:install -- NODE_ID --ssh SSH_ALIAS`。

## systemd 服务状态

```json
"services": [
  {
    "name": "example.service",
    "label": "Example Service",
    "severity": "P1"
  }
]
```

Agent 只读取 unit 状态，不启动、停止、重启或 reload 服务。最多 16 项。

## ICMP：延迟与丢包

### 节点到节点

探针写在源 VPS。`target_node_id` 必须与目标节点的 Lume 节点 ID 一致：

```json
"probes": [
  {
    "name": "peer_icmp",
    "label": "Source VPS → Destination VPS",
    "category": "node-link",
    "target_node_id": "destination-vps",
    "kind": "icmp",
    "target": "destination.example.net",
    "timeout_seconds": 4,
    "samples": 5,
    "sample_interval_ms": 250,
    "warning_ms": 30,
    "critical_ms": 50,
    "warning_failure_percent": 20,
    "critical_failure_percent": 60,
    "severity": "P1",
    "display_order": 10,
    "primary": true
  }
]
```

### 外部参考目标

目标不是 Lume 节点时使用 `external`，并且只探测你有权使用的目标：

```json
{
  "name": "external_icmp",
  "label": "External Reference",
  "category": "external",
  "kind": "icmp",
  "target": "reference.example.net",
  "timeout_seconds": 4,
  "samples": 5,
  "sample_interval_ms": 250,
  "warning_ms": 300,
  "critical_ms": 500,
  "warning_failure_percent": 20,
  "critical_failure_percent": 60,
  "severity": "P2",
  "display_order": 20
}
```

ICMP 失败可能来自真实链路丢包，也可能来自目标或中间设备的 ICMP 过滤、
限速；它不等同于应用服务不可用。

## TCP：端口可达性

TCP 适合 ICMP 被屏蔽、但需要判断真实业务端口是否可以建立连接的场景。
它只完成 TCP 三次握手并立即关闭，不发送 TLS、HTTP、登录或业务数据。

```json
{
  "name": "peer_tcp_443",
  "label": "Source VPS → Destination VPS · TCP 443",
  "category": "node-link",
  "target_node_id": "destination-vps",
  "kind": "tcp",
  "target": "destination.example.net",
  "port": 443,
  "timeout_seconds": 3,
  "connect_timeout_ms": 1000,
  "samples": 3,
  "sample_interval_ms": 250,
  "warning_ms": 500,
  "critical_ms": 1500,
  "warning_failure_percent": 1,
  "critical_failure_percent": 60,
  "severity": "P2",
  "display_order": 30
}
```

TCP 的失败比例叫**建连失败率**，不是丢包率。连接失败只能说明本轮从源
节点到指定 `target:port` 未能及时建立 TCP；它可能来自链路、ACL、防火墙、
监听服务或连接队列，不能单独定位根因。详情页会将 TCP 与 ICMP 使用不同
术语；首页仍只展示 ICMP 三网/链路能量格，避免改变日常信息层级。

TCP 默认 3 个样本。`connect_timeout_ms` 是单次连接上限，整个采样计划必须
满足：

```text
(samples - 1) × sample_interval_ms + connect_timeout_ms
≤ timeout_seconds × 1000
```

## 通信探针字段

| 字段 | 含义 |
| --- | --- |
| `name` | 节点内稳定且唯一的历史标识 |
| `label` | 面板和 Telegram 显示名 |
| `category` | `node-link`、`external` 或安全的描述性分类 |
| `target_node_id` | `node-link` 必填；其他分类不填 |
| `kind` | `icmp` 或 `tcp` |
| `target` | 不含协议、端口、路径的主机名或 IP |
| `port` | 仅 TCP 必填，1–65535 |
| `timeout_seconds` | 整轮上限，1–15 秒 |
| `connect_timeout_ms` | 仅 TCP；单次建连上限，100–5000 ms |
| `samples` | 1–10；ICMP 默认 5，TCP 默认 3 |
| `sample_interval_ms` | 样本启动间隔，100–5000 ms，默认 250 ms |
| `warning_ms` / `critical_ms` | 本轮代表延迟的关注/异常阈值；0 为关闭 |
| `warning_failure_percent` / `critical_failure_percent` | ICMP 丢包或 TCP 建连失败阈值 |
| `severity` | `P1`、`P2` 或 `INFO` |
| `display_order` | 稳定显示顺序 |
| `primary` | 可选的首选摘要探针 |

## nftables：规则命中增量

该模块适合回答“这条转发规则最近是否仍有新命中”，不抓包、不复制流量，
也不上传规则内容、IP、域名或字节载荷。规则本身必须包含 `counter` 表达式。

```json
"nftables_counters": [
  {
    "name": "relay_443_matches",
    "label": "443 转发规则",
    "family": "ip",
    "table": "relay_nat",
    "chain": "prerouting",
    "protocol": "tcp",
    "destination_port": 443,
    "rule_comment": "lume:relay-443",
    "display_order": 10
  }
]
```

`rule_comment` 可省略，但选择器必须在指定 chain 中只匹配一条“协议 + 目标
端口 + counter”规则。若同一 chain 有多条相同端口规则，必须先给目标规则
添加唯一 comment，再配置同一 comment；Lume 遇到零条或多条匹配会明确
报错，不会猜测。

面板展示的是相邻两次内核 packet counter 的差值及“次/分”速率。它是
**规则命中次数**：对典型 NAT `prerouting` 规则通常接近新流/首包数，但具体
含义由规则所在 hook、匹配条件和连接跟踪行为决定，不能宣称为用户数、会话
数或业务字节数。计数器降低或规则重建时标为“已重置”，下一轮重新建立基线。

### 权限与运行方式

- 常驻 `vpsmon-agent.service` 仍以 `vpsmon` 无特权用户运行，能力集为空。
- 只有配置了 `nftables_counters` 时，安装/升级器才启用
  `vpsmon-nftables-snapshot.timer`。
- timer 每 60 秒以 `vpsmon` 用户触发一次短时 oneshot；只有该进程临时获得
  `CAP_NET_ADMIN`，读取指定 chain 后只写入数字快照
  `/var/lib/vpsmon/nftables-counters.json`。
- 常驻 Agent 只读该快照。没有配置时 timer 关闭，快照删除，不发生后台读取。

手工核验：

```bash
systemctl status vpsmon-nftables-snapshot.timer --no-pager
sudo systemctl start vpsmon-nftables-snapshot.service
sudo cat /var/lib/vpsmon/nftables-counters.json
```

输出应只有计数器名称、包/字节累计值和时间戳，不应出现规则、目标地址或域名。

## 存储与资源成本

- ICMP/TCP 结果共用每节点每轮一行 `probe_rounds_v3`，启用 TCP 不新增一张
  按探针写入的时间表。
- nftables 数字增量压入已有的每节点资源样本行，启用后不增加 D1 历史行数。
- 两者都会少量增加报告 JSON 和读取结果大小；TCP 另产生配置样本数对应的
  短连接。nftables 模块不产生网络探测流量。
- 原始 nftables 增量随资源样本保留 30 天；当前版本不为它生成 400/730 天
  长期 rollup，因此 90 天视图最多显示仍在原始保留期内的数据。

## 干净停用

### 停用一个通信探针

从 `probes` 删除目标条目，生成候选配置并执行 Agent `--dry-run`，再按升级
流程安装。也可使用 `deploy/prune-probes.py` 生成不覆盖原文件的候选配置。
下一份认证报告会把对应 `probe_catalog` 和派生 `business_routes` 设为禁用。

### 停用 nftables 观测

从 `nftables_counters` 删除目标条目并部署候选配置。若数组变为空，升级器会：

1. `disable --now vpsmon-nftables-snapshot.timer`；
2. 删除数字快照；
3. 下一份报告停用对应 `counter_catalog` 行。

它不会删除、修改或重载业务 nftables 规则。完整卸载 Agent 时，
`deploy/uninstall-agent.sh --confirm` 也会删除可选 helper unit 与快照。

历史数据是被动记录，不会继续发包。原始样本按保留策略自然过期；为停止
采集无需手工删除历史表。
