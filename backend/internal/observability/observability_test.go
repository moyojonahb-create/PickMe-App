package observability

import (
	"testing"

	"github.com/prometheus/client_golang/prometheus"
)

func TestRecordRateLimiterRedisFallbackIncrementsCounter(t *testing.T) {
	before := rateLimiterRedisFallbackTotalValue(t)

	RecordRateLimiterRedisFallback()
	RecordRateLimiterRedisFallback()
	RecordRateLimiterRedisFallback()

	after := rateLimiterRedisFallbackTotalValue(t)
	if after-before != 3 {
		t.Fatalf("expected counter to increase by 3, went from %v to %v", before, after)
	}
}

func rateLimiterRedisFallbackTotalValue(t *testing.T) float64 {
	t.Helper()
	families, err := prometheus.DefaultGatherer.Gather()
	if err != nil {
		t.Fatal(err)
	}
	for _, family := range families {
		if family.GetName() != "rate_limiter_redis_fallback_total" {
			continue
		}
		for _, metric := range family.GetMetric() {
			if metric.GetCounter() != nil {
				return metric.GetCounter().GetValue()
			}
		}
	}
	return 0
}
