# Ubuntu Deployment

Target: Ubuntu 22.04 or 24.04 LTS.

## Packages

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git nginx ufw certbot python3-certbot-nginx
```

Install Docker from Docker's official apt repository, then:

```bash
sudo useradd --system --home /opt/pickme --shell /usr/sbin/nologin pickme || true
sudo mkdir -p /opt/pickme /var/log/pickme /var/lib/pickme /etc/pickme
sudo chown -R pickme:pickme /opt/pickme /var/log/pickme /var/lib/pickme
```

## Application

```bash
cd /opt/pickme
git clone <repo-url> .
cp .env.example .env
cp backend/.env.example /etc/pickme/backend.env
```

Fill real secrets in `.env` and `/etc/pickme/backend.env`.

## Docker Mode

```bash
docker compose config
docker compose build
docker compose up -d
docker compose --profile worker --profile scheduler up -d
```

## Binary + Systemd Mode

```bash
cd /opt/pickme/backend
go build -trimpath -ldflags="-s -w" -o /opt/pickme/bin/pickme-server ./cmd/server
go build -trimpath -ldflags="-s -w" -o /opt/pickme/bin/pickme-worker ./cmd/worker
go build -trimpath -ldflags="-s -w" -o /opt/pickme/bin/pickme-scheduler ./cmd/scheduler
sudo cp /opt/pickme/ops/systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now pickme-backend pickme-asynq-worker pickme-asynq-scheduler
sudo systemctl status pickme-backend
sudo systemctl status pickme-asynq-worker
sudo systemctl status pickme-asynq-scheduler
```

`pickme-backend` runs only the HTTP API and WebSocket server. `pickme-asynq-worker` runs only background job processing. `pickme-asynq-scheduler` runs only scheduled job registration and is intentionally idle when no recurring jobs are configured.

## Verification

```bash
curl -fsS http://127.0.0.1:3000/health/live
curl -fsS http://127.0.0.1:3000/health/ready
curl -fsS http://127.0.0.1:3000/health/dependencies
curl -fsS -H "Authorization: Bearer $ADMIN_JWT" http://127.0.0.1:3000/admin/jobs/stats
```
