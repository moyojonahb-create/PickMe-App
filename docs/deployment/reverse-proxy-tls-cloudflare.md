# Reverse Proxy, TLS, Cloudflare, and Domains

## Domains

Recommended DNS:

- `pickme.example.com` -> frontend
- `api.pickme.example.com` -> Go backend
- `grafana.pickme.example.com` -> Grafana, restricted by VPN/IP allowlist

## NGINX

Use:

```text
ops/nginx/pickme.conf
```

Replace placeholder domains and certificate paths before enabling.

```bash
sudo cp ops/nginx/pickme.conf /etc/nginx/sites-available/pickme.conf
sudo ln -s /etc/nginx/sites-available/pickme.conf /etc/nginx/sites-enabled/pickme.conf
sudo nginx -t
sudo systemctl reload nginx
```

## TLS

```bash
sudo certbot --nginx -d pickme.example.com -d api.pickme.example.com -d grafana.pickme.example.com
```

Enable HSTS only after certificate renewal has been tested.

## Cloudflare

- Use proxied records for frontend and API.
- Keep Grafana behind Cloudflare Access or VPN.
- Set SSL/TLS mode to Full Strict.
- Enable WAF managed rules.
- Add rate limiting at Cloudflare for `/api/*`, `/ws`, and auth-adjacent endpoints.
- Do not cache API responses.
- Cache `/assets/*` aggressively.

## Firewall

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Do not expose Redis, Prometheus, Grafana, or PostgreSQL publicly.
