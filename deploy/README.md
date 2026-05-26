# PPT-SVG Deployment

This is an optional deployment example for serving the Next.js app from `/ppt` behind Nginx.

For a normal clone or local test, Nginx is not required:

```bash
cd /dev/ppt-svg/PPT-SVG
npm install
npm run dev
```

Then open `http://localhost:3000/ppt/en` or `http://localhost:3000/ppt/zh`.

## Build the app

Only set `NEXT_PUBLIC_BASE_PATH=/ppt` when deploying behind this Nginx subpath config:

```bash
cd /dev/ppt-svg/PPT-SVG
npm ci
NEXT_PUBLIC_BASE_PATH=/ppt npm run build
```

Make sure `/dev/ppt-svg/PPT-SVG/.env.local` contains the OpenRouter settings from `.env.example`.

## Install the systemd service

```bash
sudo cp deploy/systemd/ppt-svg.service /etc/systemd/system/ppt-svg.service
sudo systemctl daemon-reload
sudo systemctl enable --now ppt-svg
sudo systemctl status ppt-svg
```

This example service binds the app to `127.0.0.1:3000` so Nginx can proxy to it. Edit `WorkingDirectory`, `PATH`, and `ExecStart` in `deploy/systemd/ppt-svg.service` if your clone lives somewhere else.

## Install the Nginx config

```bash
sudo cp deploy/nginx/ppt-svg.conf /etc/nginx/conf.d/ppt-svg.conf
sudo nginx -t
sudo systemctl reload nginx
```

The config accepts `labs.graptolite.ai`. DNS still needs to point this hostname to the server.

## Test

```bash
curl -i http://127.0.0.1:3000/ppt/en
curl -i -X POST http://127.0.0.1:3000/ppt/api/generate \
  -H 'Content-Type: application/json' \
  --data '{"skillId":"freeform","userDescription":"test flow","language":"en"}'
curl -i http://labs.graptolite.ai/ppt/healthz
curl -i http://labs.graptolite.ai/ppt
```

Access logs are written to `/var/log/nginx/ppt-svg.access.log`.
Error logs are written to `/var/log/nginx/ppt-svg.error.log`.

The Nginx rate limits are:

- `/ppt/api/generate`: 6 requests per minute per client IP, burst 3.
- `/ppt/*`: 5 requests per second per client IP, burst 20.

The Nginx config trusts Cloudflare's published IP ranges and uses `CF-Connecting-IP`, so logs and rate limits are keyed by the visitor IP instead of the Cloudflare edge IP.
