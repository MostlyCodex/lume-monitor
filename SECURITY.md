# Security Policy

## Supported version

Security fixes target the latest release and the default branch.

## Reporting a vulnerability

Please use GitHub private vulnerability reporting when it is enabled for this repository. Do not include live Worker tokens, Telegram tokens, node secrets, private IP addresses, SSH material, or unredacted production reports in a public issue.

## Secret handling

The repository must never contain:

- `NODE_KEYS`, `ADMIN_TOKEN`, Telegram Bot tokens, webhook secrets, or binding codes;
- Cloudflare account tokens, API keys, production D1 identifiers, or private Worker URLs;
- SSH private keys, host inventories, real Agent `config.json` files, or DPAPI-encrypted bundles;
- raw production exports containing source IPs, hostnames, ASN data, or Telegram identifiers.

Store Worker credentials with `wrangler secret put`. Store each Agent secret only in `/etc/vpsmon/config.json`, owned by `root:vpsmon` with mode `0640` or stricter.

## Runtime model

- Agents make outbound connections only and open no listening port.
- Reports are signed with HMAC-SHA256 and checked for timestamp freshness and nonce replay.
- Dashboard sessions use HttpOnly, Secure cookies and one-time login tokens.
- Telegram Webhook requests require Telegram's secret-token header.
- The Agent systemd unit drops capabilities and applies filesystem, namespace, memory, CPU, and task limits.
- ICMP probes use Linux unprivileged datagram ping sockets. The Agent does not request root or `CAP_NET_RAW`; an unavailable ping socket is reported as an explicit probe error.

## Deployment responsibility

Review probe targets and local laws or provider policies before deployment. This project does not perform automatic route switching and should not be granted permission to modify production firewall or proxy configuration.
