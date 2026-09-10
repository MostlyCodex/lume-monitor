package collect

import (
	"reflect"
	"strings"
	"testing"
)

func TestSelectedInterfaceDoesNotDoubleCountBridgeTraffic(t *testing.T) {
	dev := "eth0: 100 1 2 3 0 0 0 0 200 1 4 5 0 0 0 0\ndocker0: 100 1 0 0 0 0 0 0 200 1 0 0 0 0 0 0\nveth0: 100 1 0 0 0 0 0 0 200 1 0 0 0 0 0 0\nlo: 900 1 0 0 0 0 0 0 900 1 0 0 0 0 0 0"
	available, err := parseNetDev(dev)
	if err != nil {
		t.Fatal(err)
	}
	result, err := selectNetwork(available, []string{"eth0"}, nil)
	if err != nil || result.RX != 100 || result.TX != 200 || result.RXErrors != 2 || result.TXDrops != 5 {
		t.Fatalf("unexpected totals: %+v %v", result, err)
	}
	if _, ok := available["lo"]; ok {
		t.Fatal("loopback was included")
	}
	manual, err := selectNetwork(available, nil, []string{"veth0"})
	if err != nil || manual.RX != 100 {
		t.Fatal("explicit virtual interface should be allowed")
	}
	if _, err = selectNetwork(available, nil, []string{"missing"}); err == nil {
		t.Fatal("missing interface was silently ignored")
	}
}
func TestDefaultRoutesUseMetricAndRequireAnUnambiguousInterface(t *testing.T) {
	available := map[string]NetStats{"eth0": {}, "eth1": {}, "wg0": {}}
	v4 := "Iface Destination Gateway Flags RefCnt Use Metric Mask\neth1 00000000 01000000 0003 0 0 200 00000000\neth0 00000000 01000000 0003 0 0 100 00000000"
	names := defaultRouteNames(v4, "", available)
	if !reflect.DeepEqual(names, []string{"eth0"}) {
		t.Fatal(names)
	}
	v6 := strings.Repeat("0", 32) + " 00 " + strings.Repeat("0", 32) + " 00 " + strings.Repeat("0", 32) + " 00000064 00000000 00000000 00000003 wg0"
	names = defaultRouteNames(v4, v6, available)
	if _, err := selectNetwork(available, names, nil); err == nil {
		t.Fatal("ambiguous IPv4/IPv6 routes were summed")
	}
	if _, err := selectNetwork(available, nil, nil); err == nil {
		t.Fatal("missing default route fell back to all interfaces")
	}
	names = defaultRouteNames(v4+"\neth1 00000000 01000000 0003 0 0 100 00000000", "", available)
	if len(names) != 2 {
		t.Fatal("equal-cost default routes were silently reduced")
	}
}
func TestCounterScopeChangesWhenInterfaceIsRecreated(t *testing.T) {
	a := map[string]NetStats{"eth0": {Index: 2}}
	first, _ := selectNetwork(a, []string{"eth0"}, nil)
	a["eth0"] = NetStats{Index: 3}
	second, _ := selectNetwork(a, []string{"eth0"}, nil)
	if first.Scope == second.Scope {
		t.Fatal("recreated interface reused counter identity")
	}
	if _, err := parseNetDev("eth0: invalid"); err == nil {
		t.Fatal("invalid counters were accepted as zero")
	}
}
