package collect

import "sync"

type Collector struct {
	mu        sync.Mutex
	prevTotal uint64
	prevIdle  uint64
}

func New() *Collector {
	return &Collector{}
}
