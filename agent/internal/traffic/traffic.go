package traffic

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"sort"
	"time"

	"github.com/MostlyCodex/lume-monitor/agent/internal/config"
	"github.com/MostlyCodex/lume-monitor/agent/internal/model"
)

const stateVersion = 2

type state struct {
	Version     int                                `json:"version"`
	ResetDay    int                                `json:"reset_day"`
	TimeZone    string                             `json:"time_zone"`
	PeriodStart int64                              `json:"period_start"`
	RXBytes     uint64                             `json:"rx_bytes"`
	TXBytes     uint64                             `json:"tx_bytes"`
	BootID      string                             `json:"boot_id"`
	Interfaces  []string                           `json:"interfaces"`
	Counters    map[string]model.InterfaceCounters `json:"counters"`
	LastSeen    int64                              `json:"last_seen"`
}

type Tracker struct {
	path string
}

func New(path string) *Tracker {
	return &Tracker{path: path}
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

// PeriodStart is the reset-day midnight that opened the period containing now.
// Months without the reset day reset on their last day.
func PeriodStart(now time.Time, day int, timeZone string) time.Time {
	now = now.In(zone(timeZone))
	year, month, _ := now.Date()
	start := boundary(year, month, day, now.Location())
	if now.Before(start) {
		start = boundary(year, month-1, day, now.Location())
	}
	return start
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
	if s.Version != stateVersion || s.LastSeen <= 0 || len(s.Interfaces) == 0 || len(s.Interfaces) > 16 || len(s.Counters) != len(s.Interfaces) {
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

// Observe adds the interface counter growth since the previous sample to the
// current period. Counting starts when the Agent first runs; a reboot, counter
// reset or replaced interface only re-bases the counters, and a new period,
// a changed reset day, time zone or interface selection starts again from zero.
func (t *Tracker) Observe(now time.Time, cfg config.TrafficCycle, system model.SystemMetrics, persist bool) (*model.TrafficCycle, error) {
	if !system.NetworkValid {
		return nil, nil
	}
	if len(system.NetworkCounters) == 0 || system.BootID == "" {
		return nil, errors.New("traffic accounting requires interface counters and boot identity")
	}
	previous, err := readState(t.path)
	if err != nil {
		log.Printf("traffic state unreadable, counting starts again: %v", err)
		previous = state{}
	}
	names := append([]string(nil), system.NetworkInterfaces...)
	sort.Strings(names)
	samePolicy := previous.Version == stateVersion && previous.ResetDay == cfg.ResetDay &&
		previous.TimeZone == cfg.TimeZone && reflect.DeepEqual(previous.Interfaces, names)
	if samePolicy && now.Unix() <= previous.LastSeen {
		// The clock moved backwards; keep the stored totals untouched.
		return &model.TrafficCycle{RXBytes: previous.RXBytes, TXBytes: previous.TXBytes}, nil
	}
	start := PeriodStart(now, cfg.ResetDay, cfg.TimeZone).Unix()
	next := state{
		Version: stateVersion, ResetDay: cfg.ResetDay, TimeZone: cfg.TimeZone, PeriodStart: start,
		BootID: system.BootID, Interfaces: names, Counters: system.NetworkCounters, LastSeen: now.Unix(),
	}
	if samePolicy && previous.PeriodStart == start {
		next.RXBytes, next.TXBytes = previous.RXBytes, previous.TXBytes
		if previous.BootID == system.BootID {
			for name, current := range system.NetworkCounters {
				last, ok := previous.Counters[name]
				if ok && current.Index == last.Index && current.RX >= last.RX && current.TX >= last.TX {
					next.RXBytes += current.RX - last.RX
					next.TXBytes += current.TX - last.TX
				}
			}
		}
	}
	if persist {
		if err = saveState(t.path, next); err != nil {
			return nil, fmt.Errorf("save traffic state: %w", err)
		}
	}
	return &model.TrafficCycle{RXBytes: next.RXBytes, TXBytes: next.TXBytes}, nil
}
