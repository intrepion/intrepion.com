# Tutorial 3: Repository Setup & Infrastructure

In this tutorial, we will set up the fundamental structure for your monorepo. Keeping everything in a single repository makes it easier to manage shared configurations, deployments, and overall project context.

## Prerequisites

- `just` command runner installed (see [just.systems](https://just.systems/man/en/))

## Step 1: Initialize the Monorepo

Now we can create a new directory for your project and initialize Git locally:

```bash
mkdir application-cms
cd application-cms
git init
```

## Step 2: Add a Root Workspace File

Since we will eventually have multiple environments (marketing, client, api) inside this repository, using a task runner like `just` is highly recommended. We will add specific commands to this file as we build out the sub-projects. 

For now, let's create a base `justfile` at the root of the project:

```just
default:
    just --list
```

This ensures that running `just` without arguments will simply print out the available commands once we start adding them.

## Next Steps

With the root repository initialized, we are ready to set up the infrastructure for our media assets.

Proceed to [Tutorial 4: Cloudflare R2 Storage Integration](./04-cloudflare-r2-storage-integration.md).
