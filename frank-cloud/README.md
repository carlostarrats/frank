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
