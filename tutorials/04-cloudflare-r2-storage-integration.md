# Tutorial 4: Cloudflare R2 Storage Integration

Storing images directly in a database or serving them from your Go backend can be inefficient and incur egress fees. Instead, we use Cloudflare R2, an S3-compatible object storage service with zero egress fees, served automatically via Cloudflare's CDN.

## Step 1: Set Up Cloudflare R2

1. Log into your Cloudflare dashboard.
2. Navigate to **R2**.
3. Create a new bucket (e.g., `application-assets`).
4. In the bucket settings, attach a Custom Domain (e.g., `cdn.yourdomain.com`). This is how your Astro site will load the images efficiently.

## Step 2: Generate API Tokens

In Cloudflare, generate an API token for R2. You will need:
- Access Key ID
- Secret Access Key
- Endpoint URL (looks like `https://<account_id>.r2.cloudflarestorage.com`)

Keep these credentials handy; we will use them in the Go backend tutorial to generate presigned upload URLs.

## Next Steps

With our media storage ready, we need a place to store our structured project data (titles, descriptions, CDN links).

Proceed to [Tutorial 5: Database Integration (Neon Postgres)](./05-database-integration-neon-postgres.md).
