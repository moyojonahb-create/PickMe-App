package notification

import (
	"time"

	"github.com/prometheus/client_golang/prometheus"
)

var (
	notificationsSentTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{Name: "notifications_sent_total", Help: "Total notifications delivered by channel and type."},
		[]string{"type", "channel"},
	)
	notificationsFailedTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{Name: "notifications_failed_total", Help: "Total notification delivery failures by channel and type."},
		[]string{"type", "channel"},
	)
	notificationsRetryTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{Name: "notifications_retry_total", Help: "Total retried notification jobs by channel and type."},
		[]string{"type", "channel"},
	)
	notificationsDeliveryLatency = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{Name: "notifications_delivery_latency_seconds", Help: "Notification delivery latency in seconds.", Buckets: prometheus.DefBuckets},
		[]string{"type", "channel"},
	)
)

func init() {
	prometheus.MustRegister(
		notificationsSentTotal,
		notificationsFailedTotal,
		notificationsRetryTotal,
		notificationsDeliveryLatency,
	)
}

func recordSent(notificationType NotificationType, channel ChannelType, start time.Time) {
	notificationsSentTotal.WithLabelValues(string(notificationType), string(channel)).Inc()
	notificationsDeliveryLatency.WithLabelValues(string(notificationType), string(channel)).Observe(time.Since(start).Seconds())
}

func recordFailure(notificationType NotificationType, channel ChannelType, start time.Time) {
	notificationsFailedTotal.WithLabelValues(string(notificationType), string(channel)).Inc()
	notificationsDeliveryLatency.WithLabelValues(string(notificationType), string(channel)).Observe(time.Since(start).Seconds())
}

func recordRetry(notificationType NotificationType, channel ChannelType) {
	notificationsRetryTotal.WithLabelValues(string(notificationType), string(channel)).Inc()
}
