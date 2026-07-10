package redis

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"

	"pickme-backend/internal/config"
	"pickme-backend/internal/dispatch"
	"pickme-backend/internal/geo"
	"pickme-backend/internal/observability"
)

type Client struct {
	cfg       config.RedisConfig
	address   string
	pass      string
	db        int
	tls       bool
	idle      chan net.Conn
	semaphore chan struct{}
}

type Health struct {
	Enabled   bool    `json:"enabled"`
	Connected bool    `json:"connected"`
	LatencyMS float64 `json:"latency_ms"`
	Error     string  `json:"error,omitempty"`
}

func NewClient(cfg config.RedisConfig) (*Client, error) {
	client := &Client{cfg: cfg}
	if !cfg.Enabled {
		return client, nil
	}
	if cfg.URL == "" {
		return nil, errors.New("REDIS_URL is required when REDIS_ENABLED=true")
	}

	parsed, err := url.Parse(cfg.URL)
	if err != nil {
		return nil, err
	}
	client.address = parsed.Host
	client.tls = parsed.Scheme == "rediss"
	if parsed.User != nil {
		client.pass, _ = parsed.User.Password()
		if client.pass == "" {
			client.pass = parsed.User.Username()
		}
	}
	if parsed.Path != "" && parsed.Path != "/" {
		db, err := strconv.Atoi(strings.TrimPrefix(parsed.Path, "/"))
		if err == nil {
			client.db = db
		}
	}
	poolSize := cfg.PoolSize
	if poolSize <= 0 {
		poolSize = 16
	}
	client.idle = make(chan net.Conn, poolSize)
	client.semaphore = make(chan struct{}, poolSize)

	return client, nil
}

func (c *Client) Enabled() bool {
	return c != nil && c.cfg.Enabled
}

func (c *Client) Close() error {
	if c == nil || c.idle == nil {
		return nil
	}
	var err error
	for {
		select {
		case conn := <-c.idle:
			if closeErr := conn.Close(); closeErr != nil && err == nil {
				err = closeErr
			}
			c.releaseSlot()
		default:
			return err
		}
	}
}

func (c *Client) Ping(ctx context.Context) error {
	if !c.Enabled() {
		return nil
	}
	reply, err := c.do(ctx, "PING")
	if err != nil {
		return err
	}
	if value, ok := reply.(string); ok && value == "PONG" {
		return nil
	}
	return fmt.Errorf("unexpected redis ping response: %v", reply)
}

func (c *Client) Health(ctx context.Context) Health {
	health := Health{Enabled: c.Enabled()}
	if !c.Enabled() {
		return health
	}
	start := time.Now()
	err := c.Ping(ctx)
	health.LatencyMS = float64(time.Since(start).Microseconds()) / 1000
	if err != nil {
		health.Error = err.Error()
		return health
	}
	health.Connected = true
	return health
}

func (c *Client) HSet(ctx context.Context, key string, values map[string]string) error {
	if !c.Enabled() {
		return nil
	}
	args := []string{"HSET", key}
	for field, value := range values {
		args = append(args, field, value)
	}
	_, err := c.do(ctx, args...)
	return err
}

func (c *Client) HGetAll(ctx context.Context, key string) (map[string]string, error) {
	if !c.Enabled() {
		return map[string]string{}, nil
	}
	reply, err := c.do(ctx, "HGETALL", key)
	if err != nil {
		return nil, err
	}
	items, ok := reply.([]any)
	if !ok {
		return map[string]string{}, nil
	}
	result := make(map[string]string, len(items)/2)
	for i := 0; i+1 < len(items); i += 2 {
		field, _ := items[i].(string)
		value, _ := items[i+1].(string)
		if field != "" {
			result[field] = value
		}
	}
	return result, nil
}

func (c *Client) Expire(ctx context.Context, key string, ttl time.Duration) error {
	if !c.Enabled() {
		return nil
	}
	_, err := c.do(ctx, "EXPIRE", key, strconv.Itoa(int(ttl.Seconds())))
	return err
}

func (c *Client) IncrWithTTL(ctx context.Context, key string, ttl time.Duration) (int64, error) {
	if !c.Enabled() {
		return 0, nil
	}
	reply, err := c.do(ctx, "INCR", key)
	if err != nil {
		return 0, err
	}
	if ttl > 0 {
		if err := c.Expire(ctx, key, ttl); err != nil {
			return 0, err
		}
	}
	switch value := reply.(type) {
	case int64:
		return value, nil
	case string:
		return strconv.ParseInt(value, 10, 64)
	default:
		return 0, nil
	}
}

func (c *Client) GeoAdd(ctx context.Context, key string, longitude float64, latitude float64, member string) error {
	if !c.Enabled() {
		return nil
	}
	_, err := c.do(ctx, "GEOADD", key, formatFloat(longitude), formatFloat(latitude), member)
	return err
}

func (c *Client) GeoSearch(ctx context.Context, key string, longitude float64, latitude float64, radiusKM float64, count int) ([]geo.GeoResult, error) {
	if !c.Enabled() {
		return nil, nil
	}
	args := []string{
		"GEOSEARCH", key,
		"FROMLONLAT", formatFloat(longitude), formatFloat(latitude),
		"BYRADIUS", formatFloat(radiusKM), "km",
		"WITHDIST", "ASC",
	}
	if count > 0 {
		args = append(args, "COUNT", strconv.Itoa(count))
	}

	reply, err := c.do(ctx, args...)
	if err != nil {
		return nil, err
	}
	rows, ok := reply.([]any)
	if !ok {
		return nil, nil
	}
	results := make([]geo.GeoResult, 0, len(rows))
	for _, row := range rows {
		parts, ok := row.([]any)
		if !ok || len(parts) < 2 {
			continue
		}
		member, _ := parts[0].(string)
		distanceText, _ := parts[1].(string)
		distance, _ := strconv.ParseFloat(distanceText, 64)
		if member != "" {
			results = append(results, geo.GeoResult{Member: member, DistanceKM: distance})
		}
	}
	return results, nil
}

func (c *Client) EnqueueDispatchJob(ctx context.Context, queue string, job dispatch.DispatchJob) (string, error) {
	if !c.Enabled() {
		return "", nil
	}
	payload, err := json.Marshal(job)
	if err != nil {
		return "", err
	}
	reply, err := c.do(ctx, "XADD", queue, "*", "payload", string(payload), "ride_id", job.Ride.RideID, "attempt", strconv.Itoa(job.Attempt))
	if err != nil {
		return "", err
	}
	id, _ := reply.(string)
	return id, nil
}

func (c *Client) AcquireLock(ctx context.Context, key string, value string, ttl time.Duration) (bool, error) {
	if !c.Enabled() {
		return true, nil
	}
	if ttl <= 0 {
		ttl = 30 * time.Second
	}
	reply, err := c.do(ctx, "SET", key, value, "NX", "PX", strconv.FormatInt(ttl.Milliseconds(), 10))
	if err != nil {
		return false, err
	}
	return reply == "OK", nil
}

func (c *Client) ReleaseLock(ctx context.Context, key string, value string) error {
	if !c.Enabled() {
		return nil
	}
	script := "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end"
	_, err := c.do(ctx, "EVAL", script, "1", key, value)
	return err
}

func (c *Client) Publish(ctx context.Context, channel string, payload []byte) error {
	if !c.Enabled() {
		return nil
	}
	_, err := c.do(ctx, "PUBLISH", channel, string(payload))
	return err
}

func (c *Client) Subscribe(ctx context.Context, channel string, handler func([]byte)) error {
	if !c.Enabled() {
		return nil
	}
	conn, err := c.dedicatedConn(ctx)
	if err != nil {
		return err
	}
	defer func() {
		_ = conn.Close()
		c.releaseSlot()
	}()

	_ = conn.SetDeadline(time.Time{})
	reader := bufio.NewReader(conn)
	if err := writeArray(conn, "SUBSCRIBE", channel); err != nil {
		return err
	}

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		reply, err := readRESP(reader)
		if err != nil {
			return err
		}
		items, ok := reply.([]any)
		if !ok || len(items) < 3 {
			continue
		}
		kind, _ := items[0].(string)
		if kind != "message" {
			continue
		}
		payloadText, _ := items[2].(string)
		handler([]byte(payloadText))
	}
}

func (c *Client) do(ctx context.Context, args ...string) (any, error) {
	if !c.Enabled() {
		return nil, nil
	}
	operation := "unknown"
	if len(args) > 0 {
		operation = strings.ToLower(args[0])
	}
	observability.RecordRedisOperation(operation)
	conn, err := c.acquire(ctx)
	if err != nil {
		observability.RecordRedisFailure(operation)
		observability.CaptureError(err)
		return nil, err
	}
	reusable := false
	defer func() {
		if reusable {
			c.release(conn)
		} else {
			_ = conn.Close()
			c.releaseSlot()
		}
	}()
	_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
	reader := bufio.NewReader(conn)
	if err := writeArray(conn, args...); err != nil {
		observability.RecordRedisFailure(operation)
		observability.CaptureError(err)
		return nil, err
	}
	reply, err := readRESP(reader)
	if err != nil {
		observability.RecordRedisFailure(operation)
		observability.CaptureError(err)
		return nil, err
	}
	reusable = true
	return reply, nil
}

func (c *Client) dedicatedConn(ctx context.Context) (net.Conn, error) {
	select {
	case c.semaphore <- struct{}{}:
		return c.dial(ctx)
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (c *Client) acquire(ctx context.Context) (net.Conn, error) {
	select {
	case conn := <-c.idle:
		return conn, nil
	default:
	}
	select {
	case c.semaphore <- struct{}{}:
		return c.dial(ctx)
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (c *Client) dial(ctx context.Context) (net.Conn, error) {
	timeout := 2 * time.Second
	if deadline, ok := ctx.Deadline(); ok {
		timeout = time.Until(deadline)
		if timeout <= 0 {
			return nil, ctx.Err()
		}
	}
	dialer := net.Dialer{Timeout: timeout}
	var conn net.Conn
	var err error
	if c.tls {
		conn, err = tls.DialWithDialer(&dialer, "tcp", c.address, &tls.Config{MinVersion: tls.VersionTLS12})
	} else {
		conn, err = dialer.DialContext(ctx, "tcp", c.address)
	}
	if err != nil {
		c.releaseSlot()
		return nil, err
	}
	_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
	reader := bufio.NewReader(conn)
	if c.pass != "" {
		if err := writeArray(conn, "AUTH", c.pass); err != nil {
			_ = conn.Close()
			c.releaseSlot()
			return nil, err
		}
		if _, err := readRESP(reader); err != nil {
			_ = conn.Close()
			c.releaseSlot()
			return nil, err
		}
	}
	if c.db > 0 {
		if err := writeArray(conn, "SELECT", strconv.Itoa(c.db)); err != nil {
			_ = conn.Close()
			c.releaseSlot()
			return nil, err
		}
		if _, err := readRESP(reader); err != nil {
			_ = conn.Close()
			c.releaseSlot()
			return nil, err
		}
	}
	return conn, nil
}

func (c *Client) release(conn net.Conn) {
	_ = conn.SetDeadline(time.Time{})
	select {
	case c.idle <- conn:
	default:
		_ = conn.Close()
		c.releaseSlot()
	}
}

func (c *Client) releaseSlot() {
	select {
	case <-c.semaphore:
	default:
	}
}

func writeArray(conn net.Conn, args ...string) error {
	if _, err := fmt.Fprintf(conn, "*%d\r\n", len(args)); err != nil {
		return err
	}
	for _, arg := range args {
		if _, err := fmt.Fprintf(conn, "$%d\r\n%s\r\n", len(arg), arg); err != nil {
			return err
		}
	}
	return nil
}

func readRESP(reader *bufio.Reader) (any, error) {
	prefix, err := reader.ReadByte()
	if err != nil {
		return nil, err
	}
	line, err := reader.ReadString('\n')
	if err != nil {
		return nil, err
	}
	line = strings.TrimSuffix(strings.TrimSuffix(line, "\n"), "\r")

	switch prefix {
	case '+':
		return line, nil
	case '-':
		return nil, errors.New(line)
	case ':':
		return strconv.ParseInt(line, 10, 64)
	case '$':
		size, err := strconv.Atoi(line)
		if err != nil || size < 0 {
			return "", err
		}
		buf := make([]byte, size+2)
		if _, err := io.ReadFull(reader, buf); err != nil {
			return nil, err
		}
		return string(buf[:size]), nil
	case '*':
		size, err := strconv.Atoi(line)
		if err != nil || size < 0 {
			return []any{}, err
		}
		values := make([]any, 0, size)
		for i := 0; i < size; i++ {
			value, err := readRESP(reader)
			if err != nil {
				return nil, err
			}
			values = append(values, value)
		}
		return values, nil
	default:
		return nil, fmt.Errorf("unknown redis response prefix %q", prefix)
	}
}

func formatFloat(value float64) string {
	return strconv.FormatFloat(value, 'f', -1, 64)
}
