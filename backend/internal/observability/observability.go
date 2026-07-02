package observability

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/getsentry/sentry-go"
	"github.com/gofiber/fiber/v2"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/common/expfmt"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.37.0"
	"go.opentelemetry.io/otel/trace"
)

type Config struct {
	ServiceName  string
	Environment  string
	Release      string
	SentryDSN    string
	OTELEnabled  bool
	OTLPEndpoint string
}

var (
	httpRequestsTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{Name: "requests_total", Help: "Total HTTP requests."},
		[]string{"method", "route", "status"},
	)
	httpRequestDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{Name: "request_duration_seconds", Help: "HTTP request duration in seconds.", Buckets: prometheus.DefBuckets},
		[]string{"method", "route", "status"},
	)
	httpRequestsInFlight = prometheus.NewGauge(
		prometheus.GaugeOpts{Name: "requests_in_flight", Help: "Current in-flight HTTP requests."},
	)

	ridesCreatedTotal   = prometheus.NewCounter(prometheus.CounterOpts{Name: "rides_created_total", Help: "Total rides created."})
	ridesStartedTotal   = prometheus.NewCounter(prometheus.CounterOpts{Name: "rides_started_total", Help: "Total rides started."})
	ridesCompletedTotal = prometheus.NewCounter(prometheus.CounterOpts{Name: "rides_completed_total", Help: "Total rides completed."})
	ridesCancelledTotal = prometheus.NewCounter(prometheus.CounterOpts{Name: "rides_cancelled_total", Help: "Total rides cancelled."})

	dispatchOfferWavesTotal       = prometheus.NewCounter(prometheus.CounterOpts{Name: "dispatch_offer_waves_total", Help: "Total dispatch offer waves created."})
	dispatchOfferAcceptancesTotal = prometheus.NewCounter(prometheus.CounterOpts{Name: "dispatch_offer_acceptances_total", Help: "Total accepted dispatch offers."})
	dispatchOfferExpiredTotal     = prometheus.NewCounter(prometheus.CounterOpts{Name: "dispatch_offer_expired_total", Help: "Total expired dispatch offers."})

	walletDepositsTotal    = prometheus.NewCounter(prometheus.CounterOpts{Name: "wallet_deposits_total", Help: "Total wallet deposit requests."})
	walletWithdrawalsTotal = prometheus.NewCounter(prometheus.CounterOpts{Name: "wallet_withdrawals_total", Help: "Total wallet withdrawal requests."})
	walletTransfersTotal   = prometheus.NewCounter(prometheus.CounterOpts{Name: "wallet_transfers_total", Help: "Total wallet transfer requests."})
	walletFailuresTotal    = prometheus.NewCounterVec(
		prometheus.CounterOpts{Name: "wallet_failures_total", Help: "Total wallet operation failures."},
		[]string{"operation"},
	)

	websocketConnections           = prometheus.NewGauge(prometheus.GaugeOpts{Name: "websocket_connections", Help: "Current active WebSocket connections."})
	websocketRooms                 = prometheus.NewGauge(prometheus.GaugeOpts{Name: "websocket_rooms", Help: "Current active WebSocket rooms."})
	websocketMessagesSentTotal     = prometheus.NewCounter(prometheus.CounterOpts{Name: "websocket_messages_sent_total", Help: "Total WebSocket messages sent."})
	websocketMessagesReceivedTotal = prometheus.NewCounter(prometheus.CounterOpts{Name: "websocket_messages_received_total", Help: "Total WebSocket messages received."})

	redisOperationsTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{Name: "redis_operations_total", Help: "Total Redis operations."},
		[]string{"operation"},
	)
	redisFailuresTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{Name: "redis_failures_total", Help: "Total Redis operation failures."},
		[]string{"operation"},
	)

	postgresQueriesTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{Name: "postgres_queries_total", Help: "Total PostgreSQL queries."},
		[]string{"operation"},
	)
	postgresFailuresTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{Name: "postgres_failures_total", Help: "Total PostgreSQL query failures."},
		[]string{"operation"},
	)

	tracer = otel.Tracer("pickme-backend")
)

func init() {
	prometheus.MustRegister(
		httpRequestsTotal,
		httpRequestDuration,
		httpRequestsInFlight,
		ridesCreatedTotal,
		ridesStartedTotal,
		ridesCompletedTotal,
		ridesCancelledTotal,
		dispatchOfferWavesTotal,
		dispatchOfferAcceptancesTotal,
		dispatchOfferExpiredTotal,
		walletDepositsTotal,
		walletWithdrawalsTotal,
		walletTransfersTotal,
		walletFailuresTotal,
		websocketConnections,
		websocketRooms,
		websocketMessagesSentTotal,
		websocketMessagesReceivedTotal,
		redisOperationsTotal,
		redisFailuresTotal,
		postgresQueriesTotal,
		postgresFailuresTotal,
	)
}

func Init(ctx context.Context, cfg Config) (func(context.Context) error, error) {
	if cfg.ServiceName == "" {
		cfg.ServiceName = "pickme-backend"
	}
	if cfg.SentryDSN != "" {
		if err := sentry.Init(sentry.ClientOptions{
			Dsn:         cfg.SentryDSN,
			Environment: cfg.Environment,
			Release:     cfg.Release,
		}); err != nil {
			return nil, err
		}
	}

	if !cfg.OTELEnabled {
		otel.SetTextMapPropagator(propagation.TraceContext{})
		return func(context.Context) error {
			sentry.Flush(2 * time.Second)
			return nil
		}, nil
	}

	opts := []otlptracehttp.Option{}
	if cfg.OTLPEndpoint != "" {
		opts = append(opts, otlptracehttp.WithEndpoint(cfg.OTLPEndpoint), otlptracehttp.WithInsecure())
	}
	exporter, err := otlptracehttp.New(ctx, opts...)
	if err != nil {
		return nil, err
	}
	res, err := resource.New(ctx,
		resource.WithAttributes(
			semconv.ServiceName(cfg.ServiceName),
			attribute.String("deployment.environment", cfg.Environment),
			attribute.String("service.version", cfg.Release),
		),
	)
	if err != nil {
		return nil, err
	}
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(res),
	)
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(propagation.TraceContext{}, propagation.Baggage{}))
	tracer = otel.Tracer(cfg.ServiceName)

	return func(ctx context.Context) error {
		sentry.Flush(2 * time.Second)
		return tp.Shutdown(ctx)
	}, nil
}

func MetricsHandler(c *fiber.Ctx) error {
	metrics, err := prometheus.DefaultGatherer.Gather()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).SendString(err.Error())
	}
	format := expfmt.NewFormat(expfmt.TypeTextPlain)
	c.Set(fiber.HeaderContentType, string(format))
	encoder := expfmt.NewEncoder(c.Response().BodyWriter(), format)
	for _, metric := range metrics {
		if err := encoder.Encode(metric); err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString(err.Error())
		}
	}
	return nil
}

func HTTPMiddleware() fiber.Handler {
	return func(c *fiber.Ctx) error {
		start := time.Now()
		httpRequestsInFlight.Inc()
		defer httpRequestsInFlight.Dec()

		method := normalizeHTTPMethod(c.Method())
		ctx := extractTraceContext(c)
		route := stableLabel(c.Route().Path)
		if route == "" {
			route = stableLabel(c.Path())
		}
		ctx, span := tracer.Start(ctx, "HTTP "+method+" "+route, trace.WithAttributes(
			semconv.HTTPRequestMethodKey.String(method),
			semconv.URLPath(c.Path()),
		))
		c.SetUserContext(ctx)
		err := c.Next()
		status := c.Response().StatusCode()
		statusText := strconv.Itoa(status)
		if finalRoute := c.Route().Path; finalRoute != "" {
			route = stableLabel(finalRoute)
		}
		span.SetAttributes(semconv.HTTPResponseStatusCode(status))
		if err != nil || status >= 500 {
			span.RecordError(fmt.Errorf("http response status=%d err=%v", status, err))
			CaptureError(fmt.Errorf("http_5xx method=%s route=%s status=%d err=%v", method, route, status, err))
		}
		span.End()

		httpRequestsTotal.WithLabelValues(method, route, statusText).Inc()
		httpRequestDuration.WithLabelValues(method, route, statusText).Observe(time.Since(start).Seconds())
		return err
	}
}

func stableLabel(value string) string {
	if value == "" {
		return ""
	}
	return string(append([]byte(nil), value...))
}

func normalizeHTTPMethod(method string) string {
	method = strings.ToUpper(strings.TrimSpace(stableLabel(method)))
	switch method {
	case "GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD":
		return method
	default:
		return "OTHER"
	}
}

func extractTraceContext(c *fiber.Ctx) context.Context {
	header := http.Header{}
	if traceparent := c.Get("traceparent"); traceparent != "" {
		header.Set("traceparent", traceparent)
	}
	if baggage := c.Get("baggage"); baggage != "" {
		header.Set("baggage", baggage)
	}
	return otel.GetTextMapPropagator().Extract(c.UserContext(), propagation.HeaderCarrier(header))
}

func StartSpan(ctx context.Context, name string, attrs ...attribute.KeyValue) (context.Context, trace.Span) {
	if ctx == nil {
		ctx = context.Background()
	}
	return tracer.Start(ctx, name, trace.WithAttributes(attrs...))
}

func CaptureError(err error) {
	if err != nil {
		sentry.CaptureException(err)
	}
}

func CapturePanic(value any) {
	if value != nil {
		sentry.CurrentHub().Recover(value)
	}
}

func RecordRideCreated()   { ridesCreatedTotal.Inc() }
func RecordRideStarted()   { ridesStartedTotal.Inc() }
func RecordRideCompleted() { ridesCompletedTotal.Inc() }
func RecordRideCancelled() { ridesCancelledTotal.Inc() }

func RecordDispatchOfferWave()       { dispatchOfferWavesTotal.Inc() }
func RecordDispatchOfferAcceptance() { dispatchOfferAcceptancesTotal.Inc() }
func RecordDispatchOfferExpired(count int64) {
	if count <= 0 {
		return
	}
	dispatchOfferExpiredTotal.Add(float64(count))
}

func RecordWalletDeposit()    { walletDepositsTotal.Inc() }
func RecordWalletWithdrawal() { walletWithdrawalsTotal.Inc() }
func RecordWalletTransfer()   { walletTransfersTotal.Inc() }
func RecordWalletFailure(operation string) {
	if operation == "" {
		operation = "unknown"
	}
	walletFailuresTotal.WithLabelValues(operation).Inc()
}

func SetWebSocketConnections(count int) { websocketConnections.Set(float64(count)) }
func SetWebSocketRooms(count int)       { websocketRooms.Set(float64(count)) }
func RecordWebSocketMessageSent()       { websocketMessagesSentTotal.Inc() }
func RecordWebSocketMessageReceived()   { websocketMessagesReceivedTotal.Inc() }

func RecordRedisOperation(operation string) {
	if operation == "" {
		operation = "unknown"
	}
	redisOperationsTotal.WithLabelValues(operation).Inc()
}
func RecordRedisFailure(operation string) {
	if operation == "" {
		operation = "unknown"
	}
	redisFailuresTotal.WithLabelValues(operation).Inc()
}

func RecordPostgresQuery(operation string) {
	if operation == "" {
		operation = "unknown"
	}
	postgresQueriesTotal.WithLabelValues(operation).Inc()
}
func RecordPostgresFailure(operation string) {
	if operation == "" {
		operation = "unknown"
	}
	postgresFailuresTotal.WithLabelValues(operation).Inc()
}
