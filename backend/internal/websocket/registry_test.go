package websocket

import (
	"sync"
	"testing"

	"github.com/gofiber/contrib/socketio"
)

func TestConnectionRegistryDeleteIfMatchesRemovesMatchingConnection(t *testing.T) {
	r := NewConnectionRegistry()
	conn := &socketio.Websocket{}
	r.Set("user-1", conn)

	if !r.DeleteIfMatches("user-1", conn) {
		t.Fatal("expected DeleteIfMatches to remove the matching connection")
	}
	if _, exists := r.Get("user-1"); exists {
		t.Fatal("expected entry to be gone after DeleteIfMatches")
	}
}

func TestConnectionRegistryDeleteIfMatchesNoOpsOnStaleConnection(t *testing.T) {
	// Simulates the P2-6 race: an old connection's slow-to-fire disconnect
	// cleanup must not evict a newer reconnection that already replaced it.
	r := NewConnectionRegistry()
	oldConn := &socketio.Websocket{}
	newConn := &socketio.Websocket{}

	r.Set("user-1", oldConn)
	r.Set("user-1", newConn) // reconnect replaces the entry

	if r.DeleteIfMatches("user-1", oldConn) {
		t.Fatal("expected DeleteIfMatches to no-op when the stored connection no longer matches")
	}
	got, exists := r.Get("user-1")
	if !exists || got != newConn {
		t.Fatal("expected the newer connection to remain registered")
	}
}

func TestConnectionRegistryDeleteIfMatchesNoOpsWhenAbsent(t *testing.T) {
	r := NewConnectionRegistry()
	conn := &socketio.Websocket{}
	if r.DeleteIfMatches("missing-user", conn) {
		t.Fatal("expected DeleteIfMatches to return false for an absent id")
	}
}

func TestConnectionRegistryConcurrentSetAndDeleteIfMatches(t *testing.T) {
	r := NewConnectionRegistry()
	const n = 100
	conns := make([]*socketio.Websocket, n)
	for i := range conns {
		conns[i] = &socketio.Websocket{}
	}

	var wg sync.WaitGroup
	wg.Add(n * 2)
	for i := 0; i < n; i++ {
		conn := conns[i]
		go func() {
			defer wg.Done()
			r.Set("user-1", conn)
		}()
		go func() {
			defer wg.Done()
			r.DeleteIfMatches("user-1", conn)
		}()
	}
	wg.Wait() // completing cleanly under `go test -race` is the assertion
}
