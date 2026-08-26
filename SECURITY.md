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

Store Worker credentials with `wrangler secret put`. On a VPS, store its Agent secret only in `/etc/vpsmon/config.json`, owned by `root:vpsmon` with mode `0640` or stricter.

The optional `lumectl` manager retains the complete `NODE_KEYS` mapping,
generated node configurations, `ADMIN_TOKEN` and Webhook setup material under
the Git-ignored `.lume/` directory so that later node additions cannot
silently revoke old keys. It never retains the Telegram Bot Token. Linux/macOS
files are created with `0700/0600` permissions; Windows uses the enclosing
directory ACL. Keep this directory out of shared folders and back up
`state.json` only to encrypted trusted storage. Git ignore is an upload guard,
not encryption.

## Runtime model

- Agents make outbound connections only and open no listening port.
- Reports are signed with HMAC-SHA256 and checked for timestamp freshness and nonce replay.
- Dashboard sessions use HttpOnly, Secure cookies and one-time login tokens.
- Telegram Webhook requests require Telegram's secret-token header.
- The Agent systemd unit drops capabilities and applies filesystem, namespace, memory, CPU, and task limits.
- ICMP probes use Linux unprivileged datagram ping sockets. The Agent does not request root or `CAP_NET_RAW`; an unavailable ping socket is reported as an explicit probe error.

## Deployment responsibility

Review probe targets and local laws or provider policies before deployment. This project does not perform automatic route switching and should not be granted permission to modify production firewall or proxy configuration.

`lumectl node install` accepts a validated SSH alias, downloads only an
explicit versioned GitHub Release over HTTPS, verifies its published SHA-256,
and uses a random exact `/tmp/vpsmon-stage.*` directory. If the Release is
unavailable it can build the current source only with an already-installed Go
toolchain; checksum mismatch is a hard failure. The remote installer continues
to refuse overwriting an existing Agent installation.
