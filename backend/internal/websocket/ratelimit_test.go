package websocket

import (
	"testing"
	"time"
)

func TestConnectionMessageLimiterAllowsUpToMax(t *testing.T) {
	limiter := newConnectionMessageLimiter(3, time.Minute)
	now := time.Now()

	for i := 0; i < 3; i++ {
		if !limiter.Allow(now) {
			t.Fatalf("expected message %d to be allowed within limit", i+1)
		}
	}
}

func TestConnectionMessageLimiterRejectsOverMax(t *testing.T) {
	limiter := newConnectionMessageLimiter(3, time.Minute)
	now := time.Now()

	for i := 0; i < 3; i++ {
		limiter.Allow(now)
	}
	if limiter.Allow(now) {
		t.Fatal("expected message beyond the limit to be rejected")
	}
	// Once over the limit, it should keep rejecting within the same window.
	if limiter.Allow(now) {
		t.Fatal("expected limiter to keep rejecting within the same window")
	}
}

func TestConnectionMessageLimiterResetsAfterWindow(t *testing.T) {
	limiter := newConnectionMessageLimiter(2, time.Second)
	start := time.Now()

	if !limiter.Allow(start) {
		t.Fatal("expected first message to be allowed")
	}
	if !limiter.Allow(start) {
		t.Fatal("expected second message to be allowed")
	}
	if limiter.Allow(start) {
		t.Fatal("expected third message in the same window to be rejected")
	}

	afterWindow := start.Add(2 * time.Second)
	if !limiter.Allow(afterWindow) {
		t.Fatal("expected a message after the window elapses to be allowed again")
	}
}

func TestNewConnectionMessageLimiterAppliesDefaultsForInvalidInput(t *testing.T) {
	limiter := newConnectionMessageLimiter(0, 0)
	if limiter.max != defaultMessageRateLimit {
		t.Fatalf("expected default max %d, got %d", defaultMessageRateLimit, limiter.max)
	}
	if limiter.window != defaultMessageRateWindow {
		t.Fatalf("expected default window %s, got %s", defaultMessageRateWindow, limiter.window)
	}

	negative := newConnectionMessageLimiter(-5, -time.Second)
	if negative.max != defaultMessageRateLimit || negative.window != defaultMessageRateWindow {
		t.Fatal("expected negative input to fall back to defaults")
	}
}

func TestDefaultMessageRateLimitAccommodatesNormalHeartbeatTraffic(t *testing.T) {
	// A client sending one heartbeat ping well within the heartbeat interval,
	// plus an occasional join_room/leave_room pair, must never be closed.
	limiter := newConnectionMessageLimiter(defaultMessageRateLimit, defaultMessageRateWindow)
	now := time.Now()

	normalMessageCount := 5 // e.g. one ping + join_room + leave_room + a couple of acks
	for i := 0; i < normalMessageCount; i++ {
		if !limiter.Allow(now) {
			t.Fatalf("expected normal message %d to be allowed, defaultMessageRateLimit=%d is too strict", i+1, defaultMessageRateLimit)
		}
	}
}
