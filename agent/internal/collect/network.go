package collect

import (
	"bufio"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/MostlyCodex/lume-monitor/agent/internal/config"
	"github.com/MostlyCodex/lume-monitor/agent/internal/model"
)

type NetStats struct {
	RX, TX, RXErrors, TXErrors, RXDrops, TXDrops uint64
	Index                                        int
}
type NetworkSnapshot struct {
	NetStats
	Interfaces []string
	Scope      string
	Counters   map[string]model.InterfaceCounters
}

func parseNetDev(raw string) (map[string]NetStats, error) {
	result := map[string]NetStats{}
	scanner := bufio.NewScanner(strings.NewReader(raw))
	for scanner.Scan() {
		line := scanner.Text()
		// Interface names may contain a colon. The delimiter is the final colon.
		pos := strings.LastIndex(line, ":")
		if pos < 0 {
			continue
		}
		name := strings.TrimSpace(line[:pos])
		if !config.ValidInterfaceName(name) {
			continue
		}
		fields := strings.Fields(line[pos+1:])
		if len(fields) != 16 {
			return nil, fmt.Errorf("invalid counters for interface %s", name)
		}
		values := make([]uint64, 16)
		for i, field := range fields {
			value, err := strconv.ParseUint(field, 10, 64)
			if err != nil {
				return nil, fmt.Errorf("invalid counters for interface %s", name)
			}
			values[i] = value
		}
		result[name] = NetStats{RX: values[0], TX: values[8], RXErrors: values[2], TXErrors: values[10], RXDrops: values[3], TXDrops: values[11]}
	}
	return result, scanner.Err()
}

func defaultRouteNames(ipv4, ipv6 string, available map[string]NetStats) []string {
	selected := map[string]bool{}
	for family, raw := range []string{ipv4, ipv6} {
		best := ^uint64(0)
		names := map[string]bool{}
		for _, line := range strings.Split(raw, "\n") {
			f := strings.Fields(line)
			var name, metricText, flagsText string
			base := 10
			if family == 0 {
				if len(f) < 8 || f[1] != "00000000" || f[7] != "00000000" {
					continue
				}
				name, metricText, flagsText = f[0], f[6], f[3]
			} else {
				if len(f) < 10 || f[0] != strings.Repeat("0", 32) || f[1] != "00" {
					continue
				}
				name, metricText, flagsText, base = f[9], f[5], f[8], 16
			}
			if _, ok := available[name]; !ok {
				continue
			}
			flags, err := strconv.ParseUint(flagsText, 16, 64)
			if err != nil || flags&1 == 0 || flags&0x200 != 0 {
				continue
			}
			metric, err := strconv.ParseUint(metricText, base, 64)
			if err != nil {
				continue
			}
			if metric < best {
				best = metric
				names = map[string]bool{}
			}
			if metric == best {
				names[name] = true
			}
		}
		for name := range names {
			selected[name] = true
		}
	}
	names := make([]string, 0, len(selected))
	for name := range selected {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

func selectNetwork(available map[string]NetStats, defaults, configured []string) (NetworkSnapshot, error) {
	names := append([]string(nil), configured...)
	if len(names) == 0 {
		if len(defaults) != 1 {
			return NetworkSnapshot{Interfaces: []string{}}, errors.New("network interface is ambiguous or has no default route; select an interface in node configuration")
		}
		names = append(names, defaults[0])
	}
	sort.Strings(names)
	result := NetworkSnapshot{Interfaces: names, Counters: map[string]model.InterfaceCounters{}}
	scope := map[string]int{}
	for _, name := range names {
		item, ok := available[name]
		if !ok {
			return NetworkSnapshot{Interfaces: names}, fmt.Errorf("configured network interface %s is unavailable", name)
		}
		result.RX += item.RX
		result.TX += item.TX
		result.RXErrors += item.RXErrors
		result.TXErrors += item.TXErrors
		result.RXDrops += item.RXDrops
		result.TXDrops += item.TXDrops
		result.Counters[name] = model.InterfaceCounters{RX: item.RX, TX: item.TX, Index: item.Index}
		scope[name] = item.Index
	}
	encoded, _ := json.Marshal(scope)
	result.Scope = fmt.Sprintf("%x", sha256.Sum256(encoded))
	return result, nil
}

func ReadNetwork(configured []string) (NetworkSnapshot, error) {
	raw, err := os.ReadFile("/proc/net/dev")
	if err != nil {
		return NetworkSnapshot{Interfaces: []string{}}, err
	}
	available, err := parseNetDev(string(raw))
	if err != nil {
		return NetworkSnapshot{Interfaces: []string{}}, err
	}
	ipv4, _ := os.ReadFile("/proc/net/route")
	ipv6, _ := os.ReadFile("/proc/net/ipv6_route")
	defaults := defaultRouteNames(string(ipv4), string(ipv6), available)
	selected, err := selectNetwork(available, defaults, configured)
	if err != nil {
		return selected, err
	}
	// Only selected interfaces need stable identities. Unrelated veth churn must
	// not interrupt collection of a physical interface.
	for _, name := range selected.Interfaces {
		stats := available[name]
		index, err := os.ReadFile(filepath.Join("/sys/class/net", name, "ifindex"))
		if err != nil {
			return NetworkSnapshot{Interfaces: selected.Interfaces}, fmt.Errorf("read interface identity: %w", err)
		}
		stats.Index, err = strconv.Atoi(strings.TrimSpace(string(index)))
		if err != nil || stats.Index < 1 {
			return NetworkSnapshot{Interfaces: selected.Interfaces}, errors.New("invalid interface identity")
		}
		available[name] = stats
	}
	return selectNetwork(available, defaults, configured)
}
