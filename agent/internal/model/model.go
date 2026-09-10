package model

type NodeMetadata struct {
	ID               string `json:"id"`
	DisplayName      string `json:"display_name"`
	Role             string `json:"role"`
	Group            string `json:"group"`
	Region           string `json:"region"`
	StaleSeconds     int    `json:"stale_seconds"`
	DisplayOrder     int    `json:"display_order"`
	Color            string `json:"color"`
	OfflineSeverity  string `json:"offline_severity"`
	IPChangeSeverity string `json:"ip_change_severity"`
}

type InterfaceCounters struct {
	RX    uint64 `json:"rx"`
	TX    uint64 `json:"tx"`
	Index int    `json:"index"`
}

type TrafficCycle struct {
	ResetDay      int    `json:"reset_day"`
	TimeZone      string `json:"time_zone"`
	PeriodStart   int64  `json:"period_start"`
	PeriodEnd     int64  `json:"period_end"`
	ObservedSince int64  `json:"observed_since"`
	RXBytes       uint64 `json:"rx_bytes"`
	TXBytes       uint64 `json:"tx_bytes"`
	Partial       bool   `json:"partial"`
}

type SystemMetrics struct {
	TrafficCycleEnabled  bool                         `json:"traffic_cycle_enabled"`
	NetworkInterfaces    []string                     `json:"network_interfaces"`
	NetworkValid         bool                         `json:"network_valid"`
	NetworkScope         string                       `json:"network_scope,omitempty"`
	NetworkCounters      map[string]InterfaceCounters `json:"-"`
	TrafficCycle         *TrafficCycle                `json:"traffic_cycle,omitempty"`
	Hostname             string                       `json:"hostname"`
	OS                   string                       `json:"os"`
	Kernel               string                       `json:"kernel"`
	Arch                 string                       `json:"arch"`
	BootID               string                       `json:"boot_id"`
	UptimeSeconds        float64                      `json:"uptime_seconds"`
	CPUPercent           float64                      `json:"cpu_percent"`
	CPUCount             int                          `json:"cpu_count,omitempty"`
	Load1                float64                      `json:"load1"`
	Load5                float64                      `json:"load5"`
	Load15               float64                      `json:"load15"`
	MemoryTotalBytes     uint64                       `json:"memory_total_bytes"`
	MemoryAvailableBytes uint64                       `json:"memory_available_bytes"`
	SwapTotalBytes       uint64                       `json:"swap_total_bytes"`
	SwapUsedBytes        uint64                       `json:"swap_used_bytes"`
	RootTotalBytes       uint64                       `json:"root_total_bytes"`
	RootFreeBytes        uint64                       `json:"root_free_bytes"`
	RootUsedPercent      float64                      `json:"root_used_percent"`
	RootInodeUsedPercent float64                      `json:"root_inode_used_percent"`
	NetworkRXBytes       uint64                       `json:"network_rx_bytes"`
	NetworkTXBytes       uint64                       `json:"network_tx_bytes"`
	NetworkRXErrors      uint64                       `json:"network_rx_errors"`
	NetworkTXErrors      uint64                       `json:"network_tx_errors"`
	NetworkRXDrops       uint64                       `json:"network_rx_drops"`
	NetworkTXDrops       uint64                       `json:"network_tx_drops"`
}

type ServiceStatus struct {
	Name     string `json:"name"`
	Label    string `json:"label"`
	Severity string `json:"severity"`
	State    string `json:"state"`
}

type ProbeResult struct {
	Name                   string   `json:"name"`
	Label                  string   `json:"label"`
	Category               string   `json:"category"`
	TargetNodeID           string   `json:"target_node_id,omitempty"`
	Kind                   string   `json:"kind"`
	Target                 string   `json:"target"`
	Port                   int      `json:"port,omitempty"`
	WarningMS              float64  `json:"warning_ms,omitempty"`
	CriticalMS             float64  `json:"critical_ms,omitempty"`
	WarningFailurePercent  float64  `json:"warning_failure_percent,omitempty"`
	CriticalFailurePercent float64  `json:"critical_failure_percent,omitempty"`
	Severity               string   `json:"severity"`
	DisplayOrder           int      `json:"display_order"`
	Primary                bool     `json:"primary,omitempty"`
	Success                bool     `json:"success"`
	Complete               bool     `json:"complete"`
	DurationMS             float64  `json:"duration_ms"`
	AverageDurationMS      float64  `json:"average_duration_ms,omitempty"`
	P95DurationMS          float64  `json:"p95_duration_ms,omitempty"`
	MinDurationMS          float64  `json:"min_duration_ms,omitempty"`
	MaxDurationMS          float64  `json:"max_duration_ms,omitempty"`
	RangeMS                float64  `json:"range_ms,omitempty"`
	JitterMS               float64  `json:"jitter_ms,omitempty"`
	Samples                int      `json:"samples,omitempty"`
	AttemptedSamples       int      `json:"attempted_samples,omitempty"`
	SuccessfulSamples      int      `json:"successful_samples,omitempty"`
	SampleFailurePercent   float64  `json:"sample_failure_percent"`
	PacketLossPercent      *float64 `json:"packet_loss_percent,omitempty"`
	RemoteIP               string   `json:"remote_ip,omitempty"`
	Error                  string   `json:"error,omitempty"`
	CheckedAt              int64    `json:"checked_at"`
}

type AgentHealth struct {
	ConfigFingerprint string `json:"config_fingerprint,omitempty"`
	QueueDepth        int    `json:"queue_depth"`
	CollectErrors     uint64 `json:"collect_errors"`
	SendErrors        uint64 `json:"send_errors"`
	StartedAt         int64  `json:"started_at"`
}

type Report struct {
	SchemaVersion int             `json:"schema_version"`
	AgentVersion  string          `json:"agent_version"`
	NodeID        string          `json:"node_id"`
	Node          NodeMetadata    `json:"node"`
	GeneratedAt   int64           `json:"generated_at"`
	System        SystemMetrics   `json:"system"`
	Services      []ServiceStatus `json:"services"`
	Probes        []ProbeResult   `json:"probes"`
	Agent         AgentHealth     `json:"agent"`
}
