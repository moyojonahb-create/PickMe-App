package redis

import (
	"bufio"
	"bytes"
	"io"
	"strings"
	"testing"
)

// trickleReader returns at most one byte per Read call, regardless of the
// caller's buffer size. This forces bufio.Reader (and anything reading
// through it) to observe short reads, the exact condition that silently
// corrupted RESP bulk-string parsing before io.ReadFull was used.
type trickleReader struct {
	data []byte
}

func (r *trickleReader) Read(p []byte) (int, error) {
	if len(r.data) == 0 {
		return 0, io.EOF
	}
	if len(p) == 0 {
		return 0, nil
	}
	p[0] = r.data[0]
	r.data = r.data[1:]
	return 1, nil
}

func TestReadRESPBulkStringSurvivesShortReads(t *testing.T) {
	payload := strings.Repeat("driver-location-payload-", 400) // > 4KB, larger than bufio's default buffer
	frame := "$" + itoa(len(payload)) + "\r\n" + payload + "\r\n"

	reader := bufio.NewReader(&trickleReader{data: []byte(frame)})
	value, err := readRESP(reader)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	got, ok := value.(string)
	if !ok {
		t.Fatalf("expected string reply, got %T", value)
	}
	if got != payload {
		t.Fatalf("bulk string corrupted under short reads: got %d bytes, want %d bytes", len(got), len(payload))
	}
}

func TestReadRESPArrayOfBulkStringsSurvivesShortReads(t *testing.T) {
	first := strings.Repeat("a", 5000)
	second := strings.Repeat("b", 3000)
	var buf bytes.Buffer
	buf.WriteString("*2\r\n")
	buf.WriteString("$" + itoa(len(first)) + "\r\n" + first + "\r\n")
	buf.WriteString("$" + itoa(len(second)) + "\r\n" + second + "\r\n")

	reader := bufio.NewReader(&trickleReader{data: buf.Bytes()})
	value, err := readRESP(reader)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	items, ok := value.([]any)
	if !ok || len(items) != 2 {
		t.Fatalf("expected array of 2 items, got %#v", value)
	}
	if items[0].(string) != first || items[1].(string) != second {
		t.Fatal("array elements corrupted under short reads")
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	digits := []byte{}
	for n > 0 {
		digits = append([]byte{byte('0' + n%10)}, digits...)
		n /= 10
	}
	return string(digits)
}
