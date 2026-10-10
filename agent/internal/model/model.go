package model

type NodeMetadata struct {
	ID               string `json:"id"`
	DisplayName      string `json:"display_name"`
	Role             string `json:"role"`
	Region           string `json:"region"`
	StaleSeconds     int    `json:"stale_seconds"`
	DisplayOrder     int    `json:"display_order"`
	IPChangeSeverity string `json:"ip_change_severity"`
}

type InterfaceCounters struct {
	RX    uint64 `json:"rx"`
	TX    uint64 `json:"tx"`
	Index int    `json:"index"`
}

// TrafficCycle is the traffic counted on the selected interfaces since the
// current monthly period began, or since the Agent started counting.
type TrafficCycle struct {
	RXBytes uint64 `json:"rx_bytes"`
	TXBytes uint64 `json:"tx_bytes"`
}

type SystemMetrics struct {
	NetworkInterfaces    []string                     `json:"network_interfaces"`
	NetworkValid         bool                         `json:"network_valid"`
	NetworkScope         string                       `json:"network_scope,omitempty"`
	NetworkCounters      map[string]InterfaceCounters `json:"-"`
	TrafficCycle         *TrafficCycle                `json:"traffic_cycle,omitempty"`
	Hostname             string                       `json:"hostname"`
	OS                   string                       `json:"os"`
	Kernel               string                       `json:"kernel"`
	BootID               string                       `json:"boot_id"`
	UptimeSeconds        float64                      `json:"uptime_seconds"`
	CPUPercent           float64                      `json:"cpu_percent"`
	CPUCount             int                          `json:"cpu_count,omitempty"`
	MemoryTotalBytes     uint64                       `json:"memory_total_bytes"`
	MemoryAvailableBytes uint64                       `json:"memory_available_bytes"`
	RootTotalBytes       uint64                       `json:"root_total_bytes"`
	RootUsedPercent      float64                      `json:"root_used_percent"`
	NetworkRXBytes       uint64                       `json:"network_rx_bytes"`
	NetworkTXBytes       uint64                       `json:"network_tx_bytes"`
}

type ServiceStatus struct {
	Name     string `json:"name"`
	Label    string `json:"label"`
	Severity string `json:"severity"`
	State    string `json:"state"`
}

// ProbeResult is one probe round. ICMP packet loss is derived from the
// attempted and successful sample counts; TCP rounds report latency and
// whether the target was reachable.
type ProbeResult struct {
	Name                   string  `json:"name"`
	Label                  string  `json:"label"`
	Category               string  `json:"category"`
	TargetNodeID           string  `json:"target_node_id,omitempty"`
	Kind                   string  `json:"kind"`
	WarningMS              float64 `json:"warning_ms,omitempty"`
	CriticalMS             float64 `json:"critical_ms,omitempty"`
	WarningFailurePercent  float64 `json:"warning_failure_percent,omitempty"`
	CriticalFailurePercent float64 `json:"critical_failure_percent,omitempty"`
	Severity               string  `json:"severity"`
	DisplayOrder           int     `json:"display_order"`
	Success                bool    `json:"success"`
	Complete               bool    `json:"complete"`
	DurationMS             float64 `json:"duration_ms"`
	Samples                int     `json:"samples"`
	AttemptedSamples       int     `json:"attempted_samples"`
	SuccessfulSamples      int     `json:"successful_samples"`
	CheckedAt              int64   `json:"checked_at"`
}

type AgentHealth struct {
	ConfigFingerprint string `json:"config_fingerprint,omitempty"`
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
