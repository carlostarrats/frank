# Frank Cloud

Self-hosted sharing backend for [Frank](https://github.com/carlostarrats/frank). Deploy this to your own Vercel account to enable shareable links with commenting.

## Deploy

1. Click the button below to deploy to your Vercel account
2. When prompted, set the `FRANK_API_KEY` environment variable:
   ```bash
   openssl rand -base64 32
   ```
   Copy the output and paste it as the value.
3. After deploy, note your URL (e.g., `https://my-frank-cloud.vercel.app`)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/carlostarrats/frank/tree/main/frank-cloud&env=FRANK_API_KEY&envDescription=API%20key%20for%20daemon%20authentication.%20Generate%20with%20openssl%20rand%20-base64%2032)

## Connect to Frank

After deploying, connect your local Frank instance:

```bash
frank connect https://your-frank-cloud.vercel.app --key YOUR_API_KEY
```

## Security Checklist

After deploying, configure these security measures:

- [ ] **Vercel Firewall:** Go to your project settings > Firewall. Add a rate limit rule: 5 requests/minute per IP on `/api/comment`
- [ ] **Environment Variables:** Verify `FRANK_API_KEY` is set and not committed to code
- [ ] **Blob Storage:** Verify Blob storage is provisioned (happens automatically on first use)
- [ ] **HTTPS:** Enforced by Vercel by default — no action needed
- [ ] **CORS:** Configured in `vercel.json` — allows all origins for the API (reviewers need access)
- [ ] **CSP:** Content Security Policy headers set on the viewer page in `vercel.json`

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/health` | API key | Connection check |
| POST | `/api/share` | API key | Upload snapshot, get share URL |
| GET | `/api/share?id=xxx` | Public | Fetch share for viewer |
| POST | `/api/comment` | Public | Add reviewer comment |

## Data

All data is stored in Vercel Blob on your account. You own it completely.

- Snapshots: `shares/{id}/snapshot.json`
- Metadata: `shares/{id}/meta.json`
- Comments: `shares/{id}/comments/{commentId}.json`

## Environment variables

| Name | Required | Description |
|---|---|---|
| `FRANK_API_KEY` | Yes | Bearer token the daemon presents on authenticated requests. Generate with `openssl rand -base64 32`. |
| `UPSTASH_REDIS_REST_URL`   | Yes | Upstash Redis REST URL. Install the "Redis (by Upstash)" integration from Vercel Marketplace and link it to the project — Vercel sets this env var automatically. |
| `UPSTASH_REDIS_REST_TOKEN` | Yes | Upstash Redis token. Auto-set by the Vercel Marketplace integration. |
| `FRANK_DIFF_BUFFER_MS`     | No  | Rolling diff buffer window (ms). Default 60000. |
| `FRANK_AUTHOR_GRACE_MS`    | No  | Author-offline grace window (ms). Default 15000. |
| `FRANK_VIEWER_CAP`         | No  | Per-share viewer cap, default 10. Intentionally low to keep Upstash Redis free-tier costs bounded; raise for paid plans or alternative hosts. |
| `FRANK_IP_RATE_PER_MIN`    | No  | Connection attempts per IP per minute. Default 120. |
| `FRANK_STATE_MAX_BYTES`    | No  | Max bytes per state-push body. Default 1048576 (1 MB). |
| `FRANK_EVENT_LIST_MAX`     | No  | Pub/sub event-list cap (LTRIM). Default 2000. |
| `FRANK_SESSION_MAX_MS`     | No  | Max duration of a live share session before auto-pause (ms). Default 7200000 (2 hours). |
| `CRON_SECRET`              | No  | If set, `/api/tick` requires `Authorization: Bearer $CRON_SECRET`. |

## v3 live-share endpoints

In addition to the v2 endpoints, this deployment exposes the live-share transport defined in `CLOUD_API.md`:

- `GET /api/share/:id/stream` — viewer-facing SSE with revision-based resume
- `GET /api/share/:id/author-stream` — daemon-facing SSE (Bearer auth required)
- `POST /api/share/:id/state` — daemon state-push (Bearer auth required)
- `POST /api/share/:id/ping` — viewer heartbeat
- `DELETE /api/share?id=<id>` — revoke (Bearer + `X-Frank-Revoke-Token`)
- `GET /api/tick` — cron backstop for author-offline detection (scheduled `*/1 * * * *` in `vercel.json`)

The Upstash Redis integration is required for live share; v2-style static shares continue to work against hosts that don't install it, via the graceful-degrade path in the daemon.
