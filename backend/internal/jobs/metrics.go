package jobs

import "github.com/prometheus/client_golang/prometheus"

var (
	jobsEnqueuedTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{Name: "jobs_enqueued_total", Help: "Total background jobs enqueued."},
		[]string{"type", "queue"},
	)
	jobsProcessedTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{Name: "jobs_processed_total", Help: "Total background jobs processed successfully."},
		[]string{"type", "queue"},
	)
	jobsFailedTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{Name: "jobs_failed_total", Help: "Total background job processing failures."},
		[]string{"type", "queue"},
	)
	jobsDeadLetterTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{Name: "jobs_dead_letter_total", Help: "Total background jobs that exhausted retries."},
		[]string{"type", "queue"},
	)
	jobsQueueSize = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{Name: "jobs_queue_size", Help: "Current Asynq queue size by queue and state."},
		[]string{"queue", "state"},
	)
)

func init() {
	prometheus.MustRegister(
		jobsEnqueuedTotal,
		jobsProcessedTotal,
		jobsFailedTotal,
		jobsDeadLetterTotal,
		jobsQueueSize,
	)
}

func recordQueueStats(stat QueueStats) {
	jobsQueueSize.WithLabelValues(stat.Queue, "pending").Set(float64(stat.Pending))
	jobsQueueSize.WithLabelValues(stat.Queue, "active").Set(float64(stat.Active))
	jobsQueueSize.WithLabelValues(stat.Queue, "scheduled").Set(float64(stat.Scheduled))
	jobsQueueSize.WithLabelValues(stat.Queue, "retry").Set(float64(stat.Retry))
	jobsQueueSize.WithLabelValues(stat.Queue, "dead_letter").Set(float64(stat.DeadLetter))
	jobsQueueSize.WithLabelValues(stat.Queue, "completed").Set(float64(stat.Completed))
}
