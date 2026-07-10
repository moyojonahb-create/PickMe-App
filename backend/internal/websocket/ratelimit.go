package websocket

import "time"

// defaultMessageRateLimit and defaultMessageRateWindow bound how many
// inbound WebSocket frames (ping, join_room, leave_room, or any other
// client message) a single connection may send before it is closed.
// Legitimate traffic — heartbeat pings and occasional room join/leave —
// sits far below this. Driver location updates do not flow through this
// read loop: they arrive over HTTP (POST /drivers/location) and are only
// ever broadcast outbound to WebSocket clients, so this limit cannot
// interfere with ride/location updates.
const (
	defaultMessageRateLimit  = 30
	defaultMessageRateWindow = 10 * time.Second
)

// connectionMessageLimiter is a fixed-window counter scoped to a single
// WebSocket connection's read loop. It is intentionally not safe for
// concurrent use: each connection has exactly one goroutine reading from
// it, so no locking is needed.
type connectionMessageLimiter struct {
	max         int
	window      time.Duration
	count       int
	windowStart time.Time
}

func newConnectionMessageLimiter(max int, window time.Duration) *connectionMessageLimiter {
	if max <= 0 {
		max = defaultMessageRateLimit
	}
	if window <= 0 {
		window = defaultMessageRateWindow
	}
	return &connectionMessageLimiter{max: max, window: window}
}

// Allow records the current message against the active window and reports
// whether it is still within the limit. Once the limit is exceeded it keeps
// returning false for the rest of the window.
func (l *connectionMessageLimiter) Allow(now time.Time) bool {
	if l.windowStart.IsZero() || now.Sub(l.windowStart) >= l.window {
		l.windowStart = now
		l.count = 0
	}
	l.count++
	return l.count <= l.max
}
