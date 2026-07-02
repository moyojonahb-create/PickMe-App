package risk

import "github.com/prometheus/client_golang/prometheus"

var (
	riskEventsTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{Name: "risk_events_total", Help: "Total recorded risk events."},
		[]string{"area", "event_type"},
	)
	riskHighUsersTotal = prometheus.NewGauge(
		prometheus.GaugeOpts{Name: "risk_high_users_total", Help: "Users currently scored high or blocked."},
	)
	riskActionsTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{Name: "risk_actions_total", Help: "Total admin risk actions."},
		[]string{"action"},
	)
	fraudScanFailuresTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{Name: "fraud_scan_failures_total", Help: "Total fraud or risk scan failures."},
		[]string{"scan_type"},
	)
)

func init() {
	prometheus.MustRegister(riskEventsTotal, riskHighUsersTotal, riskActionsTotal, fraudScanFailuresTotal)
}
