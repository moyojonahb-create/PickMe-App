package database

import (
	"context"
	"os"
	"strconv"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"pickme-backend/internal/observability"
)

func NewPool(databaseURL string) (*pgxpool.Pool, error) {
	poolConfig, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, err
	}

	poolConfig.ConnConfig.DefaultQueryExecMode = queryExecModeFromEnv()
	poolConfig.MaxConns = int32(envInt("PGXPOOL_MAX_CONNS", 16))
	poolConfig.MinConns = int32(envInt("PGXPOOL_MIN_CONNS", 2))
	poolConfig.MaxConnLifetime = time.Duration(envInt("PGXPOOL_MAX_CONN_LIFETIME_SECONDS", 1800)) * time.Second
	poolConfig.MaxConnIdleTime = time.Duration(envInt("PGXPOOL_MAX_CONN_IDLE_SECONDS", 300)) * time.Second
	poolConfig.HealthCheckPeriod = time.Duration(envInt("PGXPOOL_HEALTH_CHECK_SECONDS", 30)) * time.Second
	if poolConfig.ConnConfig.RuntimeParams == nil {
		poolConfig.ConnConfig.RuntimeParams = map[string]string{}
	}
	setRuntimeParamDefault(poolConfig.ConnConfig.RuntimeParams, "statement_timeout", envString("POSTGRES_STATEMENT_TIMEOUT", "5s"))
	setRuntimeParamDefault(poolConfig.ConnConfig.RuntimeParams, "lock_timeout", envString("POSTGRES_LOCK_TIMEOUT", "1s"))
	setRuntimeParamDefault(poolConfig.ConnConfig.RuntimeParams, "idle_in_transaction_session_timeout", envString("POSTGRES_IDLE_TX_TIMEOUT", "5s"))

	return pgxpool.NewWithConfig(context.Background(), poolConfig)
}

func queryExecModeFromEnv() pgx.QueryExecMode {
	switch os.Getenv("PGX_QUERY_EXEC_MODE") {
	case "simple_protocol":
		return pgx.QueryExecModeSimpleProtocol
	case "exec":
		return pgx.QueryExecModeExec
	case "cache_describe":
		return pgx.QueryExecModeCacheDescribe
	case "describe_exec":
		return pgx.QueryExecModeDescribeExec
	default:
		return pgx.QueryExecModeCacheStatement
	}
}

func envInt(key string, fallback int) int {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func envString(key string, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}

func setRuntimeParamDefault(params map[string]string, key string, value string) {
	if value == "" {
		return
	}
	if _, exists := params[key]; !exists {
		params[key] = value
	}
}

func HealthHandler() fiber.Handler {
	return func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"status": "ok",
			"time":   time.Now(),
		})
	}
}

func TestHandler(dbpool *pgxpool.Pool, exposeErrors ...bool) fiber.Handler {
	showDetails := len(exposeErrors) > 0 && exposeErrors[0]
	return func(c *fiber.Ctx) error {
		var currentTime time.Time

		observability.RecordPostgresQuery("test_db")
		err := dbpool.QueryRow(context.Background(), "SELECT NOW()").Scan(&currentTime)
		if err != nil {
			observability.RecordPostgresFailure("test_db")
			observability.CaptureError(err)
			payload := fiber.Map{"error": "database_connectivity_check_failed"}
			if showDetails {
				payload["details"] = err.Error()
			}
			return c.Status(500).JSON(payload)
		}

		return c.JSON(fiber.Map{
			"message": "Database Connected ✅",
			"time":    currentTime,
		})
	}
}
