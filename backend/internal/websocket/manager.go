package websocket

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"sync"
	"time"

	"github.com/gofiber/contrib/socketio"

	"pickme-backend/internal/observability"
)

const (
	defaultSendQueueSize = 32
	defaultWriteTimeout  = 5 * time.Second
	defaultPingInterval  = 25 * time.Second
	defaultPongWait      = 60 * time.Second
	defaultPubSubChannel = "pickme:ws:rooms"

	RoleRider  = "rider"
	RoleDriver = "driver"

	envelopeKindRoom = "room"
	envelopeKindUser = "user"

	// DriverRoleRoom is the implicit room every driver connection joins on
	// connect (see websocket/handler.go). It lets legacy marketplace-style
	// broadcasts (e.g. an open ride offer to every online driver) reach
	// drivers on any instance via the same cross-instance-safe BroadcastRoom
	// path room messages already use, instead of requiring the sender to
	// know each driver's ID and instance up front.
	DriverRoleRoom = "role:drivers"
)

type Manager struct {
	clientsMu  sync.Mutex
	clients    map[*socketio.Websocket]*clientState
	roomsMu    sync.Mutex
	rooms      map[string]map[*socketio.Websocket]bool
	nodeID     string
	pubsub     PubSub
	pubsubChan string
	riders     *ConnectionRegistry
	drivers    *ConnectionRegistry
	seqMu      sync.Mutex
	sequences  map[string]uint64
	seenSeq    map[string]uint64
}

type clientState struct {
	send  chan []byte
	done  chan struct{}
	once  sync.Once
	mu    sync.Mutex
	rooms map[string]bool
}

type PubSub interface {
	Publish(ctx context.Context, channel string, payload []byte) error
	Subscribe(ctx context.Context, channel string, handler func([]byte)) error
}

// wsEnvelope is the single pub/sub message shape for both room broadcasts
// and direct-to-user sends, sharing one channel/subscribe loop. Kind
// discriminates which fields apply: "room" uses RoomID, "user" uses Role+UserID.
type wsEnvelope struct {
	Kind    string          `json:"kind"`
	NodeID  string          `json:"node_id"`
	RoomID  string          `json:"room_id,omitempty"`
	Role    string          `json:"role,omitempty"`
	UserID  string          `json:"user_id,omitempty"`
	Seq     uint64          `json:"seq"`
	SentAt  time.Time       `json:"sent_at"`
	Payload json.RawMessage `json:"payload"`
}

func NewManager() *Manager {
	host, _ := os.Hostname()
	if host == "" {
		host = "node"
	}
	return &Manager{
		clients:    make(map[*socketio.Websocket]*clientState),
		rooms:      make(map[string]map[*socketio.Websocket]bool),
		nodeID:     fmt.Sprintf("%s-%d", host, time.Now().UnixNano()),
		pubsubChan: defaultPubSubChannel,
		sequences:  make(map[string]uint64),
		seenSeq:    make(map[string]uint64),
	}
}

func (m *Manager) WithPubSub(pubsub PubSub) *Manager {
	m.pubsub = pubsub
	return m
}

// WithUserRegistries gives the Manager the rider/driver connection
// registries it needs for SendToUser to attempt local delivery before
// falling back to pub/sub.
func (m *Manager) WithUserRegistries(riders, drivers *ConnectionRegistry) *Manager {
	m.riders = riders
	m.drivers = drivers
	return m
}

func (m *Manager) registryForRole(role string) *ConnectionRegistry {
	switch role {
	case RoleDriver:
		return m.drivers
	case RoleRider:
		return m.riders
	default:
		return nil
	}
}

func (m *Manager) StartPubSub(ctx context.Context) {
	if m.pubsub == nil {
		return
	}
	go func() {
		for {
			err := m.pubsub.Subscribe(ctx, m.pubsubChan, func(payload []byte) {
				m.handlePubSubMessage(payload)
			})
			if ctx.Err() != nil {
				return
			}
			if err != nil {
				log.Println("WebSocket pubsub subscribe error:", err)
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(2 * time.Second):
			}
		}
	}()
}

func (m *Manager) AddClient(conn *socketio.Websocket) {
	state := &clientState{
		send:  make(chan []byte, defaultSendQueueSize),
		done:  make(chan struct{}),
		rooms: make(map[string]bool),
	}
	m.clientsMu.Lock()
	if existing, ok := m.clients[conn]; ok {
		existing.close()
	}
	m.clients[conn] = state
	count := len(m.clients)
	m.clientsMu.Unlock()
	observability.SetWebSocketConnections(count)
	go m.writeLoop(conn, state)
}

func (m *Manager) RemoveClient(conn *socketio.Websocket) {
	m.clientsMu.Lock()
	state, ok := m.clients[conn]
	if ok {
		delete(m.clients, conn)
	}
	count := len(m.clients)
	m.clientsMu.Unlock()
	observability.SetWebSocketConnections(count)
	if ok {
		for _, roomID := range state.Rooms() {
			m.LeaveRoom(roomID, conn)
		}
		state.close()
	}
}

func (m *Manager) ClientCount() int {
	m.clientsMu.Lock()
	defer m.clientsMu.Unlock()
	return len(m.clients)
}

func (m *Manager) JoinRoom(roomID string, conn *socketio.Websocket) {
	if roomID == "" || conn == nil {
		return
	}
	m.roomsMu.Lock()

	if _, exists := m.rooms[roomID]; !exists {
		m.rooms[roomID] = make(map[*socketio.Websocket]bool)
	}
	m.rooms[roomID][conn] = true
	roomCount := len(m.rooms)
	m.roomsMu.Unlock()
	observability.SetWebSocketRooms(roomCount)

	m.clientsMu.Lock()
	state := m.clients[conn]
	m.clientsMu.Unlock()
	if state != nil {
		state.Join(roomID)
	}
}

func (m *Manager) LeaveRoom(roomID string, conn *socketio.Websocket) {
	if roomID == "" || conn == nil {
		return
	}
	m.roomsMu.Lock()
	roomClients, exists := m.rooms[roomID]
	if !exists {
		m.roomsMu.Unlock()
		return
	}

	delete(roomClients, conn)
	if len(roomClients) == 0 {
		delete(m.rooms, roomID)
	}
	roomCount := len(m.rooms)
	m.roomsMu.Unlock()
	observability.SetWebSocketRooms(roomCount)

	m.clientsMu.Lock()
	state := m.clients[conn]
	m.clientsMu.Unlock()
	if state != nil {
		state.Leave(roomID)
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
	m.BroadcastRoomLocal(roomID, payload)
	m.publishRoom(roomID, payload)
}

// SendToUser delivers payload to the given role's ("rider" or "driver")
// live connection for userID. It always attempts local delivery first via
// the matching registry, and always also publishes to pub/sub — mirroring
// BroadcastRoom's unconditional local-then-publish pattern. The publish
// step must never be skipped just because local delivery appeared to
// succeed: a registry entry can be stale (not yet cleaned up) and pass Get
// while Send still fails, so the pub/sub fallback is the only reliable path
// regardless of what the local attempt reports. Returns whether local
// delivery on this instance succeeded.
func (m *Manager) SendToUser(role string, userID string, payload []byte) bool {
	delivered := false
	if registry := m.registryForRole(role); registry != nil {
		if conn, ok := registry.Get(userID); ok {
			delivered = m.Send(conn, payload)
		}
	}
	m.publishUser(role, userID, payload)
	return delivered
}

func (m *Manager) BroadcastRoomLocal(roomID string, payload []byte) {
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
		observability.RecordWebSocketMessageSent()
		return true
	default:
		observability.CaptureError(context.DeadlineExceeded)
		log.Println("WebSocket backpressure disconnect")
		m.RemoveClient(conn)
		return false
	}
}

func (m *Manager) writeLoop(conn *socketio.Websocket, state *clientState) {
	ticker := time.NewTicker(defaultPingInterval)
	defer ticker.Stop()

	for {
		select {
		case payload := <-state.send:
			_ = conn.Conn.SetWriteDeadline(time.Now().Add(defaultWriteTimeout))
			if err := conn.Conn.WriteMessage(1, payload); err != nil {
				observability.CaptureError(err)
				log.Println("WebSocket write error:", err)
				m.RemoveClient(conn)
				return
			}
		case <-ticker.C:
			_ = conn.Conn.SetWriteDeadline(time.Now().Add(defaultWriteTimeout))
			if err := conn.Conn.WriteMessage(9, nil); err != nil {
				observability.CaptureError(err)
				log.Println("WebSocket heartbeat error:", err)
				m.RemoveClient(conn)
				return
			}
		case <-state.done:
			return
		}
	}
}

func (m *Manager) publishRoom(roomID string, payload []byte) {
	if m.pubsub == nil || roomID == "" {
		return
	}
	scope := "room:" + roomID
	env := wsEnvelope{
		Kind:    envelopeKindRoom,
		NodeID:  m.nodeID,
		RoomID:  roomID,
		Seq:     m.nextSequence(scope),
		SentAt:  time.Now().UTC(),
		Payload: append([]byte(nil), payload...),
	}
	m.publishEnvelope(env)
}

func (m *Manager) publishUser(role string, userID string, payload []byte) {
	if m.pubsub == nil || role == "" || userID == "" {
		return
	}
	scope := "user:" + role + ":" + userID
	env := wsEnvelope{
		Kind:    envelopeKindUser,
		NodeID:  m.nodeID,
		Role:    role,
		UserID:  userID,
		Seq:     m.nextSequence(scope),
		SentAt:  time.Now().UTC(),
		Payload: append([]byte(nil), payload...),
	}
	m.publishEnvelope(env)
}

func (m *Manager) publishEnvelope(env wsEnvelope) {
	raw, err := json.Marshal(env)
	if err != nil {
		observability.CaptureError(err)
		log.Println("WebSocket pubsub marshal error:", err)
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := m.pubsub.Publish(ctx, m.pubsubChan, raw); err != nil {
		observability.CaptureError(err)
		log.Println("WebSocket pubsub publish error:", err)
	}
}

func (m *Manager) handlePubSubMessage(payload []byte) {
	var env wsEnvelope
	if err := json.Unmarshal(payload, &env); err != nil {
		observability.CaptureError(err)
		log.Println("WebSocket pubsub decode error:", err)
		return
	}
	if env.NodeID == "" || env.NodeID == m.nodeID || len(env.Payload) == 0 {
		return
	}
	switch env.Kind {
	case envelopeKindRoom:
		if env.RoomID == "" {
			return
		}
		if !m.acceptSequence(env.NodeID, "room:"+env.RoomID, env.Seq) {
			return
		}
		m.BroadcastRoomLocal(env.RoomID, env.Payload)
	case envelopeKindUser:
		if env.Role == "" || env.UserID == "" {
			return
		}
		if !m.acceptSequence(env.NodeID, "user:"+env.Role+":"+env.UserID, env.Seq) {
			return
		}
		registry := m.registryForRole(env.Role)
		if registry == nil {
			return
		}
		if conn, ok := registry.Get(env.UserID); ok {
			m.Send(conn, env.Payload)
		}
	}
}

func (m *Manager) nextSequence(scope string) uint64 {
	m.seqMu.Lock()
	defer m.seqMu.Unlock()
	m.sequences[scope]++
	return m.sequences[scope]
}

func (m *Manager) acceptSequence(nodeID string, scope string, seq uint64) bool {
	if seq == 0 {
		return true
	}
	key := nodeID + ":" + scope
	m.seqMu.Lock()
	defer m.seqMu.Unlock()
	if seq <= m.seenSeq[key] {
		return false
	}
	m.seenSeq[key] = seq
	return true
}

func (s *clientState) close() {
	s.once.Do(func() {
		close(s.done)
	})
}

func (s *clientState) Join(roomID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.rooms[roomID] = true
}

func (s *clientState) Leave(roomID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.rooms, roomID)
}

func (s *clientState) Rooms() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	rooms := make([]string, 0, len(s.rooms))
	for roomID := range s.rooms {
		rooms = append(rooms, roomID)
	}
	return rooms
}
