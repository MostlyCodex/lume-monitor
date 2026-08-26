package check

import (
	"context"
	"os/exec"
	"strings"
	"time"

	"github.com/MostlyCodex/lume-monitor/agent/internal/config"
	"github.com/MostlyCodex/lume-monitor/agent/internal/model"
)

func Services(parent context.Context, services []config.Service) []model.ServiceStatus {
	results := make([]model.ServiceStatus, 0, len(services))
	for _, service := range services {
		ctx, cancel := context.WithTimeout(parent, 3*time.Second)
		output, err := exec.CommandContext(ctx, "systemctl", "is-active", "--", service.Name).CombinedOutput()
		state := strings.TrimSpace(string(output))
		if state == "" {
			if ctx.Err() != nil {
				state = "timeout"
			} else if err != nil {
				state = "unknown"
			}
		}
		cancel()
		if len(state) > 32 {
			state = state[:32]
		}
		results = append(results, model.ServiceStatus{
			Name: service.Name, Label: service.Label, Severity: service.Severity, State: state,
		})
	}
	return results
}
