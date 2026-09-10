package traffic

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"sort"
	"time"

	"github.com/MostlyCodex/lume-monitor/agent/internal/config"
	"github.com/MostlyCodex/lume-monitor/agent/internal/model"
)

type state struct {
	Version    int                                `json:"version"`
	Disabled   bool                               `json:"disabled,omitempty"`
	Cycle      model.TrafficCycle                 `json:"cycle"`
	BootID     string                             `json:"boot_id"`
	Interfaces []string                           `json:"interfaces"`
	Counters   map[string]model.InterfaceCounters `json:"counters"`
	LastSeen   int64                              `json:"last_seen"`
}

type Tracker struct {
	path           string
	sampleInterval time.Duration
}

func New(path string, sampleInterval time.Duration) *Tracker {
	return &Tracker{path: path, sampleInterval: sampleInterval}
}

func zone(name string) *time.Location {
	if name == "Asia/Shanghai" {
		return time.FixedZone("Asia/Shanghai", 8*3600)
	}
	return time.UTC
}
func boundary(year int, month time.Month, day int, location *time.Location) time.Time {
	last := time.Date(year, month+1, 0, 0, 0, 0, 0, location).Day()
	if day > last {
		day = last
	}
	return time.Date(year, month, day, 0, 0, 0, 0, location)
}
func Period(now time.Time, day int, timeZone string) (time.Time, time.Time) {
	now = now.In(zone(timeZone))
	year, month, _ := now.Date()
	start := boundary(year, month, day, now.Location())
	if now.Before(start) {
		month--
		start = boundary(year, month, day, now.Location())
	}
	return start, boundary(year, month+1, day, now.Location())
}

func readState(path string) (state, error) {
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return state{}, nil
	}
	if err != nil {
		return state{}, err
	}
	if !info.Mode().IsRegular() || (runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0) || info.Size() > 16384 {
		return state{}, errors.New("traffic state must be a private regular file up to 16 KiB")
	}
	file, err := os.Open(path)
	if err != nil {
		return state{}, err
	}
	defer file.Close()
	var s state
	decoder := json.NewDecoder(io.LimitReader(file, 16385))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&s); err != nil {
		return state{}, fmt.Errorf("invalid traffic state: %w", err)
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return state{}, errors.New("invalid traffic state suffix")
	}
	if s.Version != 1 || s.LastSeen <= 0 || s.Cycle.PeriodStart <= 0 || s.Cycle.PeriodEnd <= s.Cycle.PeriodStart || s.Cycle.ObservedSince < s.Cycle.PeriodStart || len(s.Interfaces) == 0 || len(s.Interfaces) > 16 || len(s.Counters) != len(s.Interfaces) {
		return state{}, errors.New("invalid traffic state metadata")
	}
	return s, nil
}
func saveState(path string, s state) error {
	data, err := json.Marshal(s)
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".traffic-*.tmp")
	if err != nil {
		return err
	}
	name := file.Name()
	defer os.Remove(name)
	if _, err = file.Write(data); err != nil {
		file.Close()
		return err
	}
	if err = file.Sync(); err != nil {
		file.Close()
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	return os.Rename(name, path)
}

// Period totals describe observed interface deltas, not a provider's billing meter.
// Missing/reset counters never become negative or a burst of historical bytes.
func (t *Tracker) Observe(now time.Time, cfg config.TrafficCycle, system model.SystemMetrics, persist bool) (*model.TrafficCycle, error) {
	if !cfg.Enabled {
		// Remember an explicit opt-out so re-enabling starts a new baseline.
		previous, err := readState(t.path)
		if err != nil {
			return nil, err
		}
		if previous.Version == 1 && !previous.Disabled && persist {
			previous.Disabled = true
			return nil, saveState(t.path, previous)
		}
		return nil, nil
	}
	if !system.NetworkValid {
		return nil, nil
	}
	if len(system.NetworkCounters) == 0 || system.BootID == "" {
		return nil, errors.New("traffic accounting requires interface counters and boot identity")
	}
	previous, err := readState(t.path)
	if err != nil {
		return nil, err
	}
	names := append([]string(nil), system.NetworkInterfaces...)
	sort.Strings(names)
	start, end := Period(now, cfg.ResetDay, cfg.TimeZone)
	cycle := model.TrafficCycle{ResetDay: cfg.ResetDay, TimeZone: cfg.TimeZone, PeriodStart: start.Unix(), PeriodEnd: end.Unix(), ObservedSince: now.Unix(), Partial: now.Unix() > start.Unix()}
	samePolicy := previous.Version == 1 && !previous.Disabled && previous.Cycle.ResetDay == cfg.ResetDay && previous.Cycle.TimeZone == cfg.TimeZone && reflect.DeepEqual(previous.Interfaces, names)
	if samePolicy && now.Unix() <= previous.LastSeen {
		return nil, errors.New("traffic clock did not advance; retained previous counters")
	}
	samePeriod := samePolicy && previous.Cycle.PeriodStart == start.Unix()
	if samePeriod {
		cycle = previous.Cycle
	} else if samePolicy && previous.Cycle.PeriodEnd == start.Unix() &&
		now.Unix()-previous.LastSeen <= int64(2*t.sampleInterval/time.Second) {
		// A normal sample crosses the boundary after it occurs. Coverage carries
		// into the adjacent period only within two configured sample intervals.
		// A long pause cannot claim coverage from the reset boundary.
		// Boot/counter discontinuities below still mark this period partial.
		cycle.Partial = false
		cycle.ObservedSince = start.Unix()
	}
	if samePolicy {
		if previous.BootID != system.BootID {
			cycle.Partial = true
		} else {
			for name, current := range system.NetworkCounters {
				last, ok := previous.Counters[name]
				if !ok || current.Index != last.Index || current.RX < last.RX || current.TX < last.TX {
					cycle.Partial = true
					continue
				}
				// A sample straddling the reset boundary cannot be attributed exactly.
				// Start the new period from this baseline instead of charging old traffic.
				if samePeriod {
					cycle.RXBytes += current.RX - last.RX
					cycle.TXBytes += current.TX - last.TX
				}
			}
		}
	}
	if !samePeriod && cycle.Partial {
		cycle.ObservedSince = now.Unix()
	}
	next := state{Version: 1, Cycle: cycle, BootID: system.BootID, Interfaces: names, Counters: system.NetworkCounters, LastSeen: now.Unix()}
	if persist {
		if err = saveState(t.path, next); err != nil {
			return nil, fmt.Errorf("save traffic state: %w", err)
		}
	}
	return &cycle, nil
}
