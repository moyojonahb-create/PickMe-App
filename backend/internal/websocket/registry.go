package websocket

import (
	"sync"

	"github.com/gofiber/contrib/socketio"
)

type ConnectionRegistry struct {
	mu          sync.RWMutex
	connections map[string]*socketio.Websocket
}

func NewConnectionRegistry() *ConnectionRegistry {
	return &ConnectionRegistry{
		connections: make(map[string]*socketio.Websocket),
	}
}

func (r *ConnectionRegistry) Set(id string, conn *socketio.Websocket) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.connections[id] = conn
}

func (r *ConnectionRegistry) Get(id string) (*socketio.Websocket, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	conn, ok := r.connections[id]
	return conn, ok
}

func (r *ConnectionRegistry) Delete(id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.connections, id)
}

func (r *ConnectionRegistry) Count() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.connections)
}

func (r *ConnectionRegistry) Snapshot() map[string]*socketio.Websocket {
	r.mu.RLock()
	defer r.mu.RUnlock()

	snapshot := make(map[string]*socketio.Websocket, len(r.connections))
	for id, conn := range r.connections {
		snapshot[id] = conn
	}
	return snapshot
}
