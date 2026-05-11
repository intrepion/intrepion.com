# Tutorial 1: Repository Setup & Infrastructure

In this first tutorial, we will set up the fundamental structure for your monorepo. Keeping everything in a single repository makes it easier to manage shared configurations, deployments, and overall project context.

## Prerequisites

- Git installed
- `just` command runner installed

## Step 1: Initialize the Monorepo

First, create a new directory for your project and initialize Git:

```bash
mkdir portfolio-cms
cd portfolio-cms
git init
```

## Step 2: Add a Root Workspace File

Since we have multiple environments (marketing, client, api), using a task runner like `just` is highly recommended. We will add specific commands to this file as we build out the sub-projects, but for now, let's create a base `justfile` at the root:

```just
default:
    just --list
```

This ensures that running `just` without arguments will simply print out the available commands once we add them.

## Next Steps

With the root repository initialized, we are ready to set up the infrastructure for our media assets.

Proceed to [Tutorial 2: Cloudflare R2 Storage Integration](./02-cloudflare-r2-storage-integration.md).
