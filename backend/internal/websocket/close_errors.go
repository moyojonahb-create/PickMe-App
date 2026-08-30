package websocket

import (
	"errors"
	"io"
	"net"

	fasthttpws "github.com/fasthttp/websocket"
)

// isBenignDisconnect reports whether err is an ordinary client going away
// rather than something worth paging on.
//
// A phone locking its screen, switching from wifi to mobile data, or being
// backgrounded by the OS all surface here as a read/write error — most often
// close 1006 (abnormal closure). Capturing those in Sentry produced 65 events
// in three hours from a single test device; with real drivers on the road it
// would bury every genuine error under disconnect noise and burn the quota.
// They are still logged locally — they just aren't exceptions.
func isBenignDisconnect(err error) bool {
	if err == nil {
		return true
	}
	if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) || errors.Is(err, net.ErrClosed) {
		return true
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return true
	}
	return fasthttpws.IsCloseError(err,
		fasthttpws.CloseNormalClosure,
		fasthttpws.CloseGoingAway,
		fasthttpws.CloseNoStatusReceived,
		fasthttpws.CloseAbnormalClosure,
	)
}
