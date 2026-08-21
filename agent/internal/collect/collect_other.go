//go:build !linux

package collect

import (
	"errors"

	"github.com/MostlyCodex/yuanshan-monitor/agent/internal/model"
)

func (c *Collector) Collect() (model.SystemMetrics, []error) {
	return model.SystemMetrics{}, []error{errors.New("system collection is supported only on Linux")}
}
