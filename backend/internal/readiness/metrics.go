package readiness

import "github.com/prometheus/client_golang/prometheus"

var (
	pilotReadinessScore = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "pilot_readiness_score",
		Help: "Pilot readiness score from 0 to 100 based on dependency health.",
	})
	systemDegradationEventsTotal = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "system_degradation_events_total",
		Help: "Total system degradation events observed during readiness checks.",
	}, []string{"dependency", "reason"})
	dependencyFailuresTotal = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "dependency_failures_total",
		Help: "Total dependency failures observed during readiness checks.",
	}, []string{"dependency"})
)

func init() {
	prometheus.MustRegister(pilotReadinessScore)
	prometheus.MustRegister(systemDegradationEventsTotal)
	prometheus.MustRegister(dependencyFailuresTotal)
}
