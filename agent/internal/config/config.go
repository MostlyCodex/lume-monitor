package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"regexp"
	"strings"
)

const maxConfigBytes = 64 * 1024

var nodeIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,31}$`)
var servicePattern = regexp.MustCompile(`^[A-Za-z0-9_.@-]{1,80}$`)
var probeNamePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,79}$`)
var categoryPattern = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,31}$`)
var markPattern = regexp.MustCompile(`^[A-Za-z0-9]{1,4}$`)
var colorPattern = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,23}$`)
var nftIdentifierPattern = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,64}$`)

type Node struct {
	ID               string `json:"id"`
	DisplayName      string `json:"display_name"`
	ShortMark        string `json:"short_mark"`
	Role             string `json:"role"`
	Group            string `json:"group"`
	Region           string `json:"region"`
	StaleSeconds     int    `json:"stale_seconds"`
	DisplayOrder     int    `json:"display_order"`
	Color            string `json:"color"`
	OfflineSeverity  string `json:"offline_severity"`
	IPChangeSeverity string `json:"ip_change_severity"`
}

type Service struct {
	Name     string `json:"name"`
	Label    string `json:"label"`
	Severity string `json:"severity"`
}

type Probe struct {
	Name                   string  `json:"name"`
	Label                  string  `json:"label"`
	Category               string  `json:"category"`
	TargetNodeID           string  `json:"target_node_id,omitempty"`
	Kind                   string  `json:"kind"`
	Target                 string  `json:"target"`
	Port                   int     `json:"port,omitempty"`
	TimeoutSeconds         int     `json:"timeout_seconds"`
	ConnectTimeoutMS       int     `json:"connect_timeout_ms,omitempty"`
	Samples                int     `json:"samples,omitempty"`
	SampleIntervalMS       int     `json:"sample_interval_ms,omitempty"`
	WarningMS              float64 `json:"warning_ms,omitempty"`
	CriticalMS             float64 `json:"critical_ms,omitempty"`
	WarningFailurePercent  float64 `json:"warning_failure_percent,omitempty"`
	CriticalFailurePercent float64 `json:"critical_failure_percent,omitempty"`
	Severity               string  `json:"severity"`
	DisplayOrder           int     `json:"display_order"`
	Primary                bool    `json:"primary,omitempty"`
}

// NftablesCounter selects exactly one rule by chain and transport destination
// port. The privileged snapshot helper reports only numeric counters; the
// long-running Agent remains unprivileged and never receives rule contents.
type NftablesCounter struct {
	Name            string `json:"name"`
	Label           string `json:"label"`
	Family          string `json:"family"`
	Table           string `json:"table"`
	Chain           string `json:"chain"`
	Protocol        string `json:"protocol"`
	DestinationPort int    `json:"destination_port"`
	RuleComment     string `json:"rule_comment,omitempty"`
	DisplayOrder    int    `json:"display_order"`
}

type Config struct {
	Node                  Node              `json:"node"`
	Endpoint              string            `json:"endpoint"`
	Secret                string            `json:"secret"`
	ReportIntervalSeconds int               `json:"report_interval_seconds"`
	ProbeIntervalSeconds  int               `json:"probe_interval_seconds"`
	Services              []Service         `json:"services"`
	Probes                []Probe           `json:"probes"`
	NftablesCounters      []NftablesCounter `json:"nftables_counters,omitempty"`
	SpoolPath             string            `json:"spool_path"`
	AllowHTTPForTests     bool              `json:"allow_http_for_tests,omitempty"`
}

func validSeverity(value string) bool {
	return value == "P1" || value == "P2" || value == "INFO"
}

func validText(value string, max int) bool {
	return value != "" && len(value) <= max && !strings.ContainsAny(value, "\r\n\t")
}

func validProbeHost(value string) bool {
	value = strings.TrimSuffix(strings.TrimSpace(value), ".")
	if net.ParseIP(strings.Trim(value, "[]")) != nil {
		return true
	}
	if value == "" || len(value) > 253 {
		return false
	}
	for _, label := range strings.Split(value, ".") {
		if len(label) < 1 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for _, character := range label {
			if (character < 'a' || character > 'z') && (character < 'A' || character > 'Z') &&
				(character < '0' || character > '9') && character != '-' {
				return false
			}
		}
	}
	return true
}

func Load(path string) (Config, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return Config{}, fmt.Errorf("stat config: %w", err)
	}
	if info.Size() > maxConfigBytes {
		return Config{}, errors.New("config exceeds 64 KiB")
	}
	if !info.Mode().IsRegular() {
		return Config{}, errors.New("config must be a regular file, not a symlink or device")
	}
	if info.Mode().Perm()&0o037 != 0 {
		return Config{}, fmt.Errorf("config permissions %04o are too broad; expected 0640 or stricter", info.Mode().Perm())
	}
	file, err := os.Open(path)
	if err != nil {
		return Config{}, fmt.Errorf("open config: %w", err)
	}
	defer file.Close()
	decoder := json.NewDecoder(io.LimitReader(file, maxConfigBytes+1))
	decoder.DisallowUnknownFields()
	var cfg Config
	if err := decoder.Decode(&cfg); err != nil {
		return Config{}, fmt.Errorf("decode config: %w", err)
	}
	if err := cfg.Validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func (c *Config) Validate() error {
	if !nodeIDPattern.MatchString(c.Node.ID) {
		return errors.New("node.id must match [a-z0-9][a-z0-9_-]{0,31}")
	}
	if c.Node.DisplayName == "" {
		c.Node.DisplayName = c.Node.ID
	}
	if c.Node.ShortMark == "" {
		value := strings.ReplaceAll(strings.ReplaceAll(c.Node.ID, "-", ""), "_", "")
		if len(value) > 3 {
			value = value[:3]
		}
		c.Node.ShortMark = strings.ToUpper(value)
	}
	if c.Node.Role == "" {
		c.Node.Role = "VPS"
	}
	if c.Node.Group == "" {
		c.Node.Group = "default"
	}
	if c.Node.Region == "" {
		c.Node.Region = "unspecified"
	}
	if c.Node.StaleSeconds == 0 {
		c.Node.StaleSeconds = 180
	}
	if c.Node.DisplayOrder == 0 {
		c.Node.DisplayOrder = 100
	}
	if c.Node.Color == "" {
		c.Node.Color = "green"
	}
	if c.Node.OfflineSeverity == "" {
		c.Node.OfflineSeverity = "P1"
	}
	if c.Node.IPChangeSeverity == "" {
		c.Node.IPChangeSeverity = "P2"
	}
	if !validText(c.Node.DisplayName, 80) || !markPattern.MatchString(c.Node.ShortMark) ||
		!validText(c.Node.Role, 80) || !validText(c.Node.Group, 80) || !validText(c.Node.Region, 80) ||
		!colorPattern.MatchString(c.Node.Color) || c.Node.StaleSeconds < 60 || c.Node.StaleSeconds > 3600 ||
		c.Node.DisplayOrder < 1 || c.Node.DisplayOrder > 10000 || !validSeverity(c.Node.OfflineSeverity) ||
		!validSeverity(c.Node.IPChangeSeverity) {
		return errors.New("node metadata is invalid")
	}

	endpoint, err := url.Parse(c.Endpoint)
	if err != nil || endpoint.Host == "" || endpoint.Path != "/api/v1/report" || endpoint.User != nil || endpoint.RawQuery != "" || endpoint.Fragment != "" {
		return errors.New("endpoint must be a valid /api/v1/report URL")
	}
	if endpoint.Scheme != "https" && !(c.AllowHTTPForTests && endpoint.Scheme == "http") {
		return errors.New("endpoint must use HTTPS")
	}
	if len(c.Secret) < 32 || len(c.Secret) > 256 {
		return errors.New("secret must contain 32 to 256 characters")
	}
	if c.ReportIntervalSeconds == 0 {
		c.ReportIntervalSeconds = 60
	}
	if c.ProbeIntervalSeconds == 0 {
		c.ProbeIntervalSeconds = 60
	}
	if c.ReportIntervalSeconds < 30 || c.ReportIntervalSeconds > 600 {
		return errors.New("report_interval_seconds must be between 30 and 600")
	}
	if c.ProbeIntervalSeconds < c.ReportIntervalSeconds || c.ProbeIntervalSeconds > 3600 {
		return errors.New("probe_interval_seconds must be between report interval and 3600")
	}
	if len(c.Services) > 16 || len(c.Probes) > 32 || len(c.NftablesCounters) > 16 {
		return errors.New("too many services, probes, or nftables counters")
	}

	seenServices := map[string]bool{}
	for index := range c.Services {
		service := &c.Services[index]
		if !servicePattern.MatchString(service.Name) || seenServices[service.Name] {
			return fmt.Errorf("invalid or duplicate service name %q", service.Name)
		}
		seenServices[service.Name] = true
		if service.Label == "" {
			service.Label = service.Name
		}
		if service.Severity == "" {
			service.Severity = "P1"
		}
		if !validText(service.Label, 80) || !validSeverity(service.Severity) {
			return fmt.Errorf("invalid service metadata for %q", service.Name)
		}
	}

	seenProbes := map[string]bool{}
	for index := range c.Probes {
		probe := &c.Probes[index]
		if !probeNamePattern.MatchString(probe.Name) || seenProbes[probe.Name] {
			return fmt.Errorf("invalid or duplicate probe name %q", probe.Name)
		}
		seenProbes[probe.Name] = true
		if probe.Label == "" {
			probe.Label = probe.Name
		}
		if probe.Category == "" {
			probe.Category = "custom"
		}
		if probe.Severity == "" {
			probe.Severity = "P2"
		}
		if probe.DisplayOrder == 0 {
			probe.DisplayOrder = (index + 1) * 10
		}
		if !validText(probe.Label, 80) || !categoryPattern.MatchString(probe.Category) ||
			!validSeverity(probe.Severity) || probe.DisplayOrder < 1 || probe.DisplayOrder > 10000 {
			return fmt.Errorf("invalid probe metadata for %q", probe.Name)
		}
		if probe.TargetNodeID != "" && !nodeIDPattern.MatchString(probe.TargetNodeID) {
			return fmt.Errorf("probe %q target_node_id is invalid", probe.Name)
		}
		if probe.Category == "node-link" && probe.TargetNodeID == "" {
			return fmt.Errorf("probe %q requires target_node_id for node-link category", probe.Name)
		}
		if probe.Kind != "icmp" && probe.Kind != "tcp" {
			return fmt.Errorf("probe %q kind must be icmp or tcp", probe.Name)
		}
		if !validProbeHost(probe.Target) {
			return fmt.Errorf("probe %q target must be a hostname or IP address without a port", probe.Name)
		}
		if probe.TimeoutSeconds == 0 {
			if probe.Kind == "tcp" {
				probe.TimeoutSeconds = 3
			} else {
				probe.TimeoutSeconds = 4
			}
		}
		if probe.TimeoutSeconds < 1 || probe.TimeoutSeconds > 15 {
			return fmt.Errorf("probe %q timeout must be between 1 and 15 seconds", probe.Name)
		}
		if probe.Samples == 0 {
			if probe.Kind == "tcp" {
				probe.Samples = 3
			} else {
				probe.Samples = 5
			}
		}
		if probe.Samples < 1 || probe.Samples > 10 {
			return fmt.Errorf("probe %q samples must be between 1 and 10", probe.Name)
		}
		if probe.SampleIntervalMS == 0 {
			probe.SampleIntervalMS = 250
		}
		if probe.SampleIntervalMS < 100 || probe.SampleIntervalMS > 5000 {
			return fmt.Errorf("probe %q sample interval must be between 100 and 5000ms", probe.Name)
		}
		if probe.Kind == "icmp" {
			if probe.Port != 0 || probe.ConnectTimeoutMS != 0 {
				return fmt.Errorf("probe %q ICMP probes must not configure a port or connect timeout", probe.Name)
			}
			if (probe.Samples-1)*probe.SampleIntervalMS >= probe.TimeoutSeconds*1000 {
				return fmt.Errorf("probe %q sample schedule does not fit inside the round timeout", probe.Name)
			}
		} else {
			if probe.Port < 1 || probe.Port > 65535 {
				return fmt.Errorf("probe %q TCP port must be between 1 and 65535", probe.Name)
			}
			if probe.ConnectTimeoutMS == 0 {
				probe.ConnectTimeoutMS = 1000
			}
			if probe.ConnectTimeoutMS < 100 || probe.ConnectTimeoutMS > 5000 ||
				(probe.Samples-1)*probe.SampleIntervalMS+probe.ConnectTimeoutMS > probe.TimeoutSeconds*1000 {
				return fmt.Errorf("probe %q TCP connect timeout and sample schedule must fit inside the round timeout", probe.Name)
			}
		}
		if probe.WarningMS < 0 || probe.CriticalMS < 0 || probe.WarningMS > 120000 || probe.CriticalMS > 120000 ||
			(probe.WarningMS > 0 && probe.CriticalMS > 0 && probe.WarningMS > probe.CriticalMS) {
			return fmt.Errorf("probe %q latency thresholds are invalid", probe.Name)
		}
		if probe.WarningFailurePercent < 0 || probe.CriticalFailurePercent < 0 ||
			probe.WarningFailurePercent > 100 || probe.CriticalFailurePercent > 100 ||
			(probe.WarningFailurePercent > 0 && probe.CriticalFailurePercent > 0 &&
				probe.WarningFailurePercent > probe.CriticalFailurePercent) {
			return fmt.Errorf("probe %q failure-rate thresholds are invalid", probe.Name)
		}
	}

	seenCounters := map[string]bool{}
	for index := range c.NftablesCounters {
		counter := &c.NftablesCounters[index]
		if !probeNamePattern.MatchString(counter.Name) || seenCounters[counter.Name] {
			return fmt.Errorf("invalid or duplicate nftables counter name %q", counter.Name)
		}
		seenCounters[counter.Name] = true
		if counter.Label == "" {
			counter.Label = counter.Name
		}
		if counter.DisplayOrder == 0 {
			counter.DisplayOrder = (index + 1) * 10
		}
		if !validText(counter.Label, 80) || counter.DisplayOrder < 1 || counter.DisplayOrder > 10000 {
			return fmt.Errorf("invalid nftables counter metadata for %q", counter.Name)
		}
		if counter.Family != "ip" && counter.Family != "ip6" && counter.Family != "inet" {
			return fmt.Errorf("nftables counter %q family must be ip, ip6, or inet", counter.Name)
		}
		if !nftIdentifierPattern.MatchString(counter.Table) || !nftIdentifierPattern.MatchString(counter.Chain) {
			return fmt.Errorf("nftables counter %q table and chain names are invalid", counter.Name)
		}
		if counter.Protocol != "tcp" && counter.Protocol != "udp" {
			return fmt.Errorf("nftables counter %q protocol must be tcp or udp", counter.Name)
		}
		if counter.DestinationPort < 1 || counter.DestinationPort > 65535 {
			return fmt.Errorf("nftables counter %q destination_port must be between 1 and 65535", counter.Name)
		}
		if counter.RuleComment != "" && !validText(counter.RuleComment, 80) {
			return fmt.Errorf("nftables counter %q rule_comment is invalid", counter.Name)
		}
	}
	if c.SpoolPath == "" {
		c.SpoolPath = "/var/lib/vpsmon/pending.json"
	}
	if !strings.HasPrefix(c.SpoolPath, "/var/lib/vpsmon/") {
		return errors.New("spool_path must remain under /var/lib/vpsmon")
	}
	return nil
}
