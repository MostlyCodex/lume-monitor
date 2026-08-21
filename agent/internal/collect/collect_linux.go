//go:build linux

package collect

import (
	"bufio"
	"fmt"
	"os"
	"runtime"
	"strconv"
	"strings"
	"syscall"

	"github.com/MostlyCodex/yuanshan-monitor/agent/internal/model"
)

func readFirst(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(data)), nil
}

func readOS() string {
	file, err := os.Open("/etc/os-release")
	if err != nil {
		return "Linux"
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "PRETTY_NAME=") {
			value := strings.TrimPrefix(line, "PRETTY_NAME=")
			if unquoted, err := strconv.Unquote(value); err == nil {
				return unquoted
			}
			return strings.Trim(value, `"`)
		}
	}
	return "Linux"
}

func (c *Collector) cpuPercent() (float64, error) {
	file, err := os.Open("/proc/stat")
	if err != nil {
		return 0, err
	}
	defer file.Close()
	var label string
	values := make([]uint64, 10)
	if _, err := fmt.Fscan(file, &label, &values[0], &values[1], &values[2], &values[3], &values[4], &values[5], &values[6], &values[7], &values[8], &values[9]); err != nil {
		return 0, err
	}
	if label != "cpu" {
		return 0, fmt.Errorf("unexpected /proc/stat label %q", label)
	}
	total := uint64(0)
	for _, value := range values {
		total += value
	}
	idle := values[3] + values[4]
	c.mu.Lock()
	defer c.mu.Unlock()
	percent := 0.0
	if c.prevTotal > 0 && total > c.prevTotal {
		deltaTotal := total - c.prevTotal
		deltaIdle := idle - c.prevIdle
		percent = float64(deltaTotal-deltaIdle) / float64(deltaTotal) * 100
	}
	c.prevTotal, c.prevIdle = total, idle
	return percent, nil
}

func memoryMetrics() (total, available, swapTotal, swapUsed uint64, err error) {
	file, err := os.Open("/proc/meminfo")
	if err != nil {
		return 0, 0, 0, 0, err
	}
	defer file.Close()
	values := map[string]uint64{}
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) >= 2 {
			value, parseErr := strconv.ParseUint(fields[1], 10, 64)
			if parseErr == nil {
				values[strings.TrimSuffix(fields[0], ":")] = value * 1024
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return 0, 0, 0, 0, err
	}
	total = values["MemTotal"]
	available = values["MemAvailable"]
	swapTotal = values["SwapTotal"]
	if free := values["SwapFree"]; swapTotal >= free {
		swapUsed = swapTotal - free
	}
	return total, available, swapTotal, swapUsed, nil
}

func loadMetrics() (float64, float64, float64, error) {
	line, err := readFirst("/proc/loadavg")
	if err != nil {
		return 0, 0, 0, err
	}
	fields := strings.Fields(line)
	if len(fields) < 3 {
		return 0, 0, 0, fmt.Errorf("unexpected /proc/loadavg")
	}
	values := make([]float64, 3)
	for i := 0; i < 3; i++ {
		values[i], err = strconv.ParseFloat(fields[i], 64)
		if err != nil {
			return 0, 0, 0, err
		}
	}
	return values[0], values[1], values[2], nil
}

func diskMetrics() (total, free uint64, usedPercent, inodeUsedPercent float64, err error) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs("/", &stat); err != nil {
		return 0, 0, 0, 0, err
	}
	total = stat.Blocks * uint64(stat.Bsize)
	free = stat.Bavail * uint64(stat.Bsize)
	if stat.Blocks > 0 {
		usedPercent = float64(stat.Blocks-stat.Bfree) / float64(stat.Blocks) * 100
	}
	if stat.Files > 0 {
		inodeUsedPercent = float64(stat.Files-stat.Ffree) / float64(stat.Files) * 100
	}
	return total, free, usedPercent, inodeUsedPercent, nil
}

func networkMetrics() (rxBytes, txBytes, rxErrors, txErrors, rxDrops, txDrops uint64, err error) {
	file, err := os.Open("/proc/net/dev")
	if err != nil {
		return 0, 0, 0, 0, 0, 0, err
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := scanner.Text()
		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 || strings.TrimSpace(parts[0]) == "lo" {
			continue
		}
		fields := strings.Fields(parts[1])
		if len(fields) < 16 {
			continue
		}
		parse := func(index int) uint64 {
			value, _ := strconv.ParseUint(fields[index], 10, 64)
			return value
		}
		rxBytes += parse(0)
		rxErrors += parse(2)
		rxDrops += parse(3)
		txBytes += parse(8)
		txErrors += parse(10)
		txDrops += parse(11)
	}
	return rxBytes, txBytes, rxErrors, txErrors, rxDrops, txDrops, scanner.Err()
}

func (c *Collector) Collect() (model.SystemMetrics, []error) {
	errorsFound := []error{}
	hostname, err := os.Hostname()
	if err != nil {
		errorsFound = append(errorsFound, err)
	}
	kernel, err := readFirst("/proc/sys/kernel/osrelease")
	if err != nil {
		errorsFound = append(errorsFound, err)
	}
	bootID, err := readFirst("/proc/sys/kernel/random/boot_id")
	if err != nil {
		errorsFound = append(errorsFound, err)
	}
	uptimeLine, err := readFirst("/proc/uptime")
	if err != nil {
		errorsFound = append(errorsFound, err)
	}
	uptime := 0.0
	if fields := strings.Fields(uptimeLine); len(fields) > 0 {
		uptime, _ = strconv.ParseFloat(fields[0], 64)
	}
	cpu, err := c.cpuPercent()
	if err != nil {
		errorsFound = append(errorsFound, err)
	}
	load1, load5, load15, err := loadMetrics()
	if err != nil {
		errorsFound = append(errorsFound, err)
	}
	memTotal, memAvailable, swapTotal, swapUsed, err := memoryMetrics()
	if err != nil {
		errorsFound = append(errorsFound, err)
	}
	rootTotal, rootFree, rootUsed, inodeUsed, err := diskMetrics()
	if err != nil {
		errorsFound = append(errorsFound, err)
	}
	rx, tx, rxErr, txErr, rxDrop, txDrop, err := networkMetrics()
	if err != nil {
		errorsFound = append(errorsFound, err)
	}
	return model.SystemMetrics{
		Hostname: hostname, OS: readOS(), Kernel: kernel, Arch: runtime.GOARCH, BootID: bootID,
		UptimeSeconds: uptime, CPUPercent: cpu, Load1: load1, Load5: load5, Load15: load15,
		MemoryTotalBytes: memTotal, MemoryAvailableBytes: memAvailable,
		SwapTotalBytes: swapTotal, SwapUsedBytes: swapUsed,
		RootTotalBytes: rootTotal, RootFreeBytes: rootFree, RootUsedPercent: rootUsed, RootInodeUsedPercent: inodeUsed,
		NetworkRXBytes: rx, NetworkTXBytes: tx, NetworkRXErrors: rxErr, NetworkTXErrors: txErr,
		NetworkRXDrops: rxDrop, NetworkTXDrops: txDrop,
	}, errorsFound
}
