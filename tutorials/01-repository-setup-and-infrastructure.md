# Tutorial 1: Repository Setup & Infrastructure

In this first tutorial, we will set up the fundamental structure for your monorepo. Keeping everything in a single repository makes it easier to manage shared configurations, deployments, and overall project context.

## Prerequisites

- Git installed
- Node.js & npm (for Astro)
- Go (for the backend)
- Flutter SDK (for the CMS client)

## Step 1: Initialize the Monorepo

First, create a new directory for your project and initialize Git:

```bash
mkdir portfolio-cms
cd portfolio-cms
git init
```

## Step 2: Create the Directory Structure

We will separate our concerns into three main directories, as agreed upon in our architecture review:

1. `/marketing`: The Astro static site.
2. `/client`: The Flutter web CMS.
3. `/api`: The Go ConnectRPC backend.

Create these directories:

```bash
mkdir marketing client api
```

## Step 3: Add a Root Workspace File

Since we have multiple environments, using a task runner like `just` is highly recommended. Create a `justfile` at the root of your project to manage your development commands:

```just
# Run the Astro marketing site
dev-marketing:
	cd marketing && npm run dev

# Run the Go ConnectRPC backend
dev-api:
	cd api && go run cmd/server/main.go

# Run the Flutter CMS client
dev-client:
	cd client && flutter run -d chrome
```

## Next Steps

With the folder structure in place, we are ready to start building the user-facing portion of the system. 

Proceed to [Tutorial 2: The Astro Marketing Site](./02-the-astro-marketing-site.md).
