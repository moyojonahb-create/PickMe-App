package websocket

import (
	"log"
	"sync"
	"time"

	"github.com/gofiber/contrib/socketio"
)

const (
	defaultSendQueueSize = 32
	defaultWriteTimeout  = 5 * time.Second
)

type Manager struct {
	clientsMu sync.Mutex
	clients   map[*socketio.Websocket]*clientState
	roomsMu   sync.Mutex
	rooms     map[string]map[*socketio.Websocket]bool
}

type clientState struct {
	send chan []byte
	done chan struct{}
	once sync.Once
}

func NewManager() *Manager {
	return &Manager{
		clients: make(map[*socketio.Websocket]*clientState),
		rooms:   make(map[string]map[*socketio.Websocket]bool),
	}
}

func (m *Manager) AddClient(conn *socketio.Websocket) {
	state := &clientState{
		send: make(chan []byte, defaultSendQueueSize),
		done: make(chan struct{}),
	}
	m.clientsMu.Lock()
	if existing, ok := m.clients[conn]; ok {
		existing.close()
	}
	m.clients[conn] = state
	m.clientsMu.Unlock()
	go m.writeLoop(conn, state)
}

func (m *Manager) RemoveClient(conn *socketio.Websocket) {
	m.clientsMu.Lock()
	state, ok := m.clients[conn]
	if ok {
		delete(m.clients, conn)
	}
	m.clientsMu.Unlock()
	if ok {
		state.close()
	}
}

func (m *Manager) ClientCount() int {
	m.clientsMu.Lock()
	defer m.clientsMu.Unlock()
	return len(m.clients)
}

func (m *Manager) JoinRoom(roomID string, conn *socketio.Websocket) {
	m.roomsMu.Lock()
	defer m.roomsMu.Unlock()

	if _, exists := m.rooms[roomID]; !exists {
		m.rooms[roomID] = make(map[*socketio.Websocket]bool)
	}
	m.rooms[roomID][conn] = true
}

func (m *Manager) LeaveRoom(roomID string, conn *socketio.Websocket) {
	m.roomsMu.Lock()
	defer m.roomsMu.Unlock()

	roomClients, exists := m.rooms[roomID]
	if !exists {
		return
	}

	delete(roomClients, conn)
	if len(roomClients) == 0 {
		delete(m.rooms, roomID)
	}
}

func (m *Manager) Broadcast(payload []byte) {
	m.clientsMu.Lock()
	clients := make([]*socketio.Websocket, 0, len(m.clients))
	for client := range m.clients {
		clients = append(clients, client)
	}
	m.clientsMu.Unlock()

	for _, client := range clients {
		m.Send(client, payload)
	}
}

func (m *Manager) BroadcastRoom(roomID string, payload []byte) {
	m.roomsMu.Lock()
	roomClients, exists := m.rooms[roomID]
	if !exists {
		m.roomsMu.Unlock()
		return
	}

	clients := make([]*socketio.Websocket, 0, len(roomClients))
	for client := range roomClients {
		clients = append(clients, client)
	}
	m.roomsMu.Unlock()

	for _, client := range clients {
		m.Send(client, payload)
	}
}

func (m *Manager) RoomSnapshot(roomID string) map[*socketio.Websocket]bool {
	m.roomsMu.Lock()
	defer m.roomsMu.Unlock()

	roomClients, exists := m.rooms[roomID]
	if !exists {
		return map[*socketio.Websocket]bool{}
	}

	snapshot := make(map[*socketio.Websocket]bool, len(roomClients))
	for client := range roomClients {
		snapshot[client] = true
	}
	return snapshot
}

func (m *Manager) Send(conn *socketio.Websocket, payload []byte) bool {
	if conn == nil {
		return false
	}
	m.clientsMu.Lock()
	state, ok := m.clients[conn]
	m.clientsMu.Unlock()
	if !ok {
		return false
	}
	message := append([]byte(nil), payload...)
	select {
	case state.send <- message:
		return true
	default:
		log.Println("WebSocket backpressure disconnect")
		m.RemoveClient(conn)
		return false
	}
}

func (m *Manager) writeLoop(conn *socketio.Websocket, state *clientState) {
	for {
		select {
		case payload := <-state.send:
			_ = conn.Conn.SetWriteDeadline(time.Now().Add(defaultWriteTimeout))
			if err := conn.Conn.WriteMessage(1, payload); err != nil {
				log.Println("WebSocket write error:", err)
				m.RemoveClient(conn)
				return
			}
		case <-state.done:
			return
		}
	}
}

func (s *clientState) close() {
	s.once.Do(func() {
		close(s.done)
	})
}
