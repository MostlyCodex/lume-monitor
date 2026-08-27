# Contributing

Contributions are welcome through issues and pull requests.

1. Do not submit production credentials, host inventories, raw monitoring exports, or account-specific configuration.
2. Keep the Agent outbound-only and preserve the rule that it must not modify monitored services.
3. Add or update tests for behavior changes.
4. Run `go test ./...` and `go vet ./...` in `agent/`, then install Playwright Chromium and run `npm run test:ci` in `worker/`, before opening a pull request.
5. Use generic node names and example domains in tests and documentation.
6. Keep communication probes limited to the reviewed `icmp` and `tcp` primitives. Preserve the distinction among ICMP packet loss, TCP connect failure and incomplete sample coverage; update `docs/monitoring-methodology.md` when measurement semantics change.
7. Keep optional observers default-off and configuration-driven. A local privileged helper must be short-lived, narrowly capable, unable to mutate monitored services, and absent from the runtime path when its configuration is empty.

Security reports belong in private vulnerability reporting, not public issues.

The local D1 migration contract, real-browser visual contract, performance benchmark and tag-only release
process are documented in `docs/testing-and-releases.md`.
