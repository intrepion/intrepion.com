# Building a Portfolio and CMS System

Welcome to the tutorial series for building a scalable portfolio and CMS system! This architecture is designed to be simple, maintainable, and cost-effective while allowing room to grow into a more complex, AI-assisted system in the future.

## Tech Stack Overview

- **Frontend (Marketing):** Astro (Static Site Generation for perfect SEO and performance)
- **Frontend (Client/CMS):** Flutter Web (Cross-platform readiness for mobile/desktop later)
- **Backend:** Go using `net/http` + Connect RPC (Hosted on Google Cloud Run)
- **Database:** Postgres via Neon
- **Storage:** Cloudflare R2 for images and assets

## Tutorial Series

This guide is broken down into 6 step-by-step tutorials:

1. [Tutorial 1: Repository Setup & Infrastructure](./01-repository-setup-and-infrastructure.md)
   Initialize your monorepo and set up your root `justfile` for managing commands.

2. [Tutorial 2: Cloudflare R2 Storage Integration](./02-cloudflare-r2-storage-integration.md)
   Integrate Cloudflare R2 to store and serve portfolio assets and images via CDN.

3. [Tutorial 3: Database Integration (Neon Postgres)](./03-database-integration-neon-postgres.md)
   Set up your serverless Postgres database for managing CMS data.

4. [Tutorial 4: The Go ConnectRPC Backend](./04-the-go-connectrpc-backend.md)
   Initialize the Go backend, connect to the database and CDN, and set up your ConnectRPC endpoints.

5. [Tutorial 5: The Flutter CMS Client](./05-the-flutter-cms-client.md)
   Build the admin interface using Flutter Web, connecting it securely to your Go backend.

6. [Tutorial 6: The Astro Marketing Site](./06-the-astro-marketing-site.md)
   Set up Astro for the static marketing site, fetching data from your backend and generating perfect static pages.
