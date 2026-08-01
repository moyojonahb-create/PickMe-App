ARG GO_VERSION=1.26.3
FROM golang:${GO_VERSION}-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . ./
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /out/pickme-server ./cmd/server && \
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /out/pickme-worker ./cmd/worker && \
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /out/pickme-scheduler ./cmd/scheduler

FROM alpine:3.21 AS runtime
RUN addgroup -S pickme && adduser -S -D -H -G pickme pickme && apk add --no-cache ca-certificates tzdata wget
WORKDIR /app
COPY --from=build /out/pickme-server /app/pickme-server
COPY --from=build /out/pickme-worker /app/pickme-worker
COPY --from=build /out/pickme-scheduler /app/pickme-scheduler
USER pickme
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD wget -qO- http://127.0.0.1:${PORT:-3000}/health/live >/dev/null || exit 1
CMD ["/app/pickme-server"]
