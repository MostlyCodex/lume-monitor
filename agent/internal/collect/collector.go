package collect

import "sync"

type Collector struct {
	mu                sync.Mutex
	prevTotal         uint64
	prevIdle          uint64
	networkInterfaces []string
}

func New(interfaces ...string) *Collector {
	return &Collector{networkInterfaces: append([]string(nil), interfaces...)}
}
