# Contributing

Contributions are welcome through issues and pull requests.

1. Do not submit production credentials, host inventories, raw monitoring exports, or account-specific configuration.
2. Keep the Agent outbound-only and preserve the rule that it must not modify monitored services.
3. Add or update tests for behavior changes.
4. Run `go test ./...` in `agent/` and `npm run check` in `worker/` before opening a pull request.
5. Use generic node names and example domains in tests and documentation.
6. Keep communication probes ICMP-only and preserve the distinction between packet loss and incomplete sample coverage; update `docs/monitoring-methodology.md` when measurement semantics change.

Security reports belong in private vulnerability reporting, not public issues.
