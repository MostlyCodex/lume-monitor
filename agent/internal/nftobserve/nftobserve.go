package nftobserve

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/MostlyCodex/lume-monitor/agent/internal/config"
	"github.com/MostlyCodex/lume-monitor/agent/internal/model"
)

const SnapshotPath = "/var/lib/vpsmon/nftables-counters.json"

type SnapshotCounter struct {
	Name       string `json:"name"`
	Packets    uint64 `json:"packets"`
	Bytes      uint64 `json:"bytes"`
	ObservedAt int64  `json:"observed_at"`
}

type Snapshot struct {
	SchemaVersion int               `json:"schema_version"`
	GeneratedAt   int64             `json:"generated_at"`
	Counters      []SnapshotCounter `json:"counters"`
}

type nftDocument struct {
	Nftables []struct {
		Rule *nftRule `json:"rule"`
	} `json:"nftables"`
}

type nftRule struct {
	Family  string          `json:"family"`
	Table   string          `json:"table"`
	Chain   string          `json:"chain"`
	Comment string          `json:"comment"`
	Expr    []nftExpression `json:"expr"`
}

type nftExpression struct {
	Match *struct {
		Op   string `json:"op"`
		Left struct {
			Payload *struct {
				Protocol string `json:"protocol"`
				Field    string `json:"field"`
			} `json:"payload"`
		} `json:"left"`
		Right json.RawMessage `json:"right"`
	} `json:"match"`
	Counter *struct {
		Packets uint64 `json:"packets"`
		Bytes   uint64 `json:"bytes"`
	} `json:"counter"`
}

func destinationPort(raw json.RawMessage) (int, bool) {
	var number int
	if err := json.Unmarshal(raw, &number); err == nil {
		return number, true
	}
	var text string
	if err := json.Unmarshal(raw, &text); err != nil {
		return 0, false
	}
	value, err := strconv.Atoi(text)
	return value, err == nil
}

// ParseChain selects exactly one rule. Refusing ambiguous selectors prevents a
// harmless dashboard option from silently observing the wrong firewall rule.
func ParseChain(data []byte, selector config.NftablesCounter) (uint64, uint64, error) {
	var document nftDocument
	if err := json.Unmarshal(data, &document); err != nil {
		return 0, 0, fmt.Errorf("decode nftables JSON: %w", err)
	}
	type match struct {
		packets uint64
		bytes   uint64
	}
	matches := make([]match, 0, 1)
	for _, object := range document.Nftables {
		rule := object.Rule
		if rule == nil || rule.Family != selector.Family || rule.Table != selector.Table || rule.Chain != selector.Chain {
			continue
		}
		if selector.RuleComment != "" && rule.Comment != selector.RuleComment {
			continue
		}
		portMatched := false
		var ruleCounter *struct {
			Packets uint64 `json:"packets"`
			Bytes   uint64 `json:"bytes"`
		}
		for _, expression := range rule.Expr {
			if expression.Counter != nil {
				ruleCounter = expression.Counter
			}
			if expression.Match == nil || expression.Match.Op != "==" || expression.Match.Left.Payload == nil {
				continue
			}
			payload := expression.Match.Left.Payload
			port, ok := destinationPort(expression.Match.Right)
			if ok && payload.Protocol == selector.Protocol && payload.Field == "dport" && port == selector.DestinationPort {
				portMatched = true
			}
		}
		if portMatched && ruleCounter != nil {
			matches = append(matches, match{packets: ruleCounter.Packets, bytes: ruleCounter.Bytes})
		}
	}
	if len(matches) == 0 {
		return 0, 0, errors.New("no rule matched the configured selector")
	}
	if len(matches) > 1 {
		return 0, 0, errors.New("selector matched multiple rules; add a unique rule_comment")
	}
	return matches[0].packets, matches[0].bytes, nil
}

func Capture(ctx context.Context, counters []config.NftablesCounter, outputPath string) error {
	if len(counters) == 0 {
		return errors.New("no nftables counters are configured")
	}
	generatedAt := time.Now().Unix()
	chainCache := make(map[string][]byte)
	snapshot := Snapshot{SchemaVersion: 1, GeneratedAt: generatedAt, Counters: make([]SnapshotCounter, 0, len(counters))}
	for _, counter := range counters {
		key := counter.Family + "\x00" + counter.Table + "\x00" + counter.Chain
		data, ok := chainCache[key]
		if !ok {
			command := exec.CommandContext(ctx, "nft", "--json", "list", "chain", counter.Family, counter.Table, counter.Chain)
			output, err := command.Output()
			if err != nil {
				return fmt.Errorf("read configured nftables chain for %q: %w", counter.Name, err)
			}
			data = output
			chainCache[key] = data
		}
		packets, bytes, err := ParseChain(data, counter)
		if err != nil {
			return fmt.Errorf("observe nftables counter %q: %w", counter.Name, err)
		}
		snapshot.Counters = append(snapshot.Counters, SnapshotCounter{
			Name: counter.Name, Packets: packets, Bytes: bytes, ObservedAt: generatedAt,
		})
	}
	return writeSnapshot(outputPath, snapshot)
}

func writeSnapshot(path string, snapshot Snapshot) error {
	directory := filepath.Dir(path)
	temporary, err := os.CreateTemp(directory, ".nftables-counters.*")
	if err != nil {
		return fmt.Errorf("create counter snapshot: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o640); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("secure counter snapshot: %w", err)
	}
	encoder := json.NewEncoder(temporary)
	if err := encoder.Encode(snapshot); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("encode counter snapshot: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("sync counter snapshot: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close counter snapshot: %w", err)
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return fmt.Errorf("install counter snapshot: %w", err)
	}
	return nil
}

type Tracker struct {
	previous map[string]SnapshotCounter
	cached   map[string]model.CounterResult
}

func NewTracker() *Tracker {
	return &Tracker{previous: make(map[string]SnapshotCounter), cached: make(map[string]model.CounterResult)}
}

func counterError(counter config.NftablesCounter, observedAt int64, err error) model.CounterResult {
	message := strings.Join(strings.Fields(err.Error()), " ")
	if len(message) > 160 {
		message = message[:160]
	}
	return model.CounterResult{
		Name: counter.Name, Label: counter.Label, Kind: "nftables-rule", Unit: "matches",
		DisplayOrder: counter.DisplayOrder, Complete: false, ObservedAt: observedAt, Error: message,
	}
}

func (tracker *Tracker) Collect(counters []config.NftablesCounter, path string, maxAge time.Duration) []model.CounterResult {
	if len(counters) == 0 {
		return nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		results := make([]model.CounterResult, 0, len(counters))
		for _, counter := range counters {
			results = append(results, counterError(counter, time.Now().Unix(), errors.New("nftables snapshot is unavailable")))
		}
		return results
	}
	var snapshot Snapshot
	if err := json.Unmarshal(data, &snapshot); err != nil || snapshot.SchemaVersion != 1 || snapshot.GeneratedAt <= 0 {
		results := make([]model.CounterResult, 0, len(counters))
		for _, counter := range counters {
			results = append(results, counterError(counter, time.Now().Unix(), errors.New("nftables snapshot is invalid")))
		}
		return results
	}
	if age := time.Since(time.Unix(snapshot.GeneratedAt, 0)); age < 0 || age > maxAge {
		results := make([]model.CounterResult, 0, len(counters))
		for _, counter := range counters {
			results = append(results, counterError(counter, snapshot.GeneratedAt, errors.New("nftables snapshot is stale")))
		}
		return results
	}
	byName := make(map[string]SnapshotCounter, len(snapshot.Counters))
	for _, entry := range snapshot.Counters {
		byName[entry.Name] = entry
	}
	results := make([]model.CounterResult, 0, len(counters))
	for _, counter := range counters {
		current, ok := byName[counter.Name]
		if !ok {
			results = append(results, counterError(counter, snapshot.GeneratedAt, errors.New("configured counter is absent from the snapshot")))
			continue
		}
		if cached, ok := tracker.cached[counter.Name]; ok && cached.ObservedAt == current.ObservedAt {
			results = append(results, cached)
			continue
		}
		result := model.CounterResult{
			Name: counter.Name, Label: counter.Label, Kind: "nftables-rule", Unit: "matches",
			DisplayOrder: counter.DisplayOrder, Complete: true, ObservedAt: current.ObservedAt,
		}
		previous, hasPrevious := tracker.previous[counter.Name]
		if !hasPrevious || current.ObservedAt <= previous.ObservedAt {
			result.Baseline = true
		} else if current.Packets < previous.Packets {
			result.Reset = true
		} else {
			delta := current.Packets - previous.Packets
			interval := current.ObservedAt - previous.ObservedAt
			rate := float64(delta) * 60 / float64(interval)
			result.Delta = &delta
			result.IntervalSeconds = &interval
			result.RatePerMinute = &rate
		}
		tracker.previous[counter.Name] = current
		tracker.cached[counter.Name] = result
		results = append(results, result)
	}
	return results
}
