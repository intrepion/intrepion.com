# Building a Portfolio and CMS System

Welcome to the tutorial series for building a scalable portfolio and CMS system! This architecture is designed to be simple, maintainable, and cost-effective while allowing room to grow into a more complex, AI-assisted system in the future.

## Tech Stack Overview

- **Frontend (Marketing):** Astro (Static Site Generation for perfect SEO and performance)
- **Frontend (App/CMS):** Flutter Web (Cross-platform readiness for mobile/desktop later)
- **Backend:** Go using `net/http` + Connect RPC (Hosted on Google Cloud Run)
- **Database:** Postgres via Neon
- **Storage:** Cloudflare R2 for images and assets

## Tutorial Series

This guide is broken down into 6 step-by-step tutorials:

1. [Tutorial 1: Repository Setup & Infrastructure](./01-repository-setup-and-infrastructure.md)
   Learn how to structure your monorepo and organize the `/marketing`, `/app`, and `/api` directories.

2. [Tutorial 2: The Astro Marketing Site](./02-the-astro-marketing-site.md)
   Set up Astro for the static marketing site, ensuring perfect SEO and fast loading times.

3. [Tutorial 3: The Go ConnectRPC Backend](./03-the-go-connectrpc-backend.md)
   Initialize the Go backend on Google Cloud Run and set up your first ConnectRPC endpoints.

4. [Tutorial 4: Database Integration (Neon Postgres)](./04-database-integration-neon-postgres.md)
   Connect your Go backend to a serverless Neon Postgres database for managing your CMS data.

5. [Tutorial 5: Cloudflare R2 Storage Integration](./05-cloudflare-r2-storage-integration.md)
   Integrate Cloudflare R2 to store and serve portfolio assets and images via CDN.

6. [Tutorial 6: The Flutter CMS App](./06-the-flutter-cms-app.md)
   Build the admin interface using Flutter Web, connecting it securely to your Go backend.
