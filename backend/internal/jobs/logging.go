package jobs

import (
	"encoding/json"
	"log"
	"time"
)

type structuredLogger struct{}

func (structuredLogger) Debug(args ...interface{}) { logAsynq("debug", args...) }
func (structuredLogger) Info(args ...interface{})  { logAsynq("info", args...) }
func (structuredLogger) Warn(args ...interface{})  { logAsynq("warn", args...) }
func (structuredLogger) Error(args ...interface{}) { logAsynq("error", args...) }
func (structuredLogger) Fatal(args ...interface{}) { logAsynq("fatal", args...) }

func logAsynq(level string, args ...interface{}) {
	writeJobLog(map[string]any{
		"event":     "asynq_log",
		"level":     level,
		"message":   args,
		"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
	})
}

func writeJobLog(fields map[string]any) {
	raw, err := json.Marshal(fields)
	if err != nil {
		log.Printf("JOB_LOG_MARSHAL_ERROR err=%v fields=%v", err, fields)
		return
	}
	log.Println(string(raw))
}
