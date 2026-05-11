# Building an Application and CMS System

Welcome to the tutorial series for building a scalable application and CMS system! This architecture is designed to be simple, maintainable, and cost-effective while allowing room to grow into a more complex, AI-assisted system in the future.

## Tech Stack Overview

- **Frontend (Marketing):** Astro (Static Site Generation for perfect SEO and performance)
- **Frontend (Client/CMS):** Flutter Web (Cross-platform readiness for mobile/desktop later)
- **Backend:** Go using `net/http` + Connect RPC (Hosted on Google Cloud Run)
- **Database:** Postgres via Neon
- **Storage:** Cloudflare R2 for images and assets

## Tutorial Series

This guide is broken down into 8 step-by-step tutorials:

1. [Tutorial 1: Git and GitHub Setup](./01-git-and-github-setup.md)
   Learn how to install Git and create a GitHub account to host your code.

2. [Tutorial 2: SSH Key Configuration](./02-ssh-key-configuration.md)
   Set up an SSH key to securely push and pull code without entering your password.

3. [Tutorial 3: Repository Setup & Infrastructure](./03-repository-setup-and-infrastructure.md)
   Initialize your monorepo and set up your root `justfile` for managing commands.

4. [Tutorial 4: Cloudflare R2 Storage Integration](./04-cloudflare-r2-storage-integration.md)
   Integrate Cloudflare R2 to store and serve application assets and images via CDN.

5. [Tutorial 5: Database Integration (Neon Postgres)](./05-database-integration-neon-postgres.md)
   Set up your serverless Postgres database for managing CMS data.

6. [Tutorial 6: The Go ConnectRPC Backend](./06-the-go-connectrpc-backend.md)
   Initialize the Go backend, connect to the database and CDN, and set up your ConnectRPC endpoints.

7. [Tutorial 7: The Flutter CMS Client](./07-the-flutter-cms-client.md)
   Build the admin interface using Flutter Web, connecting it securely to your Go backend.

8. [Tutorial 8: The Astro Marketing Site](./08-the-astro-marketing-site.md)
   Set up Astro for the static marketing site, fetching data from your backend and generating perfect static pages.
