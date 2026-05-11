# Tutorial 1: Repository Setup & Infrastructure

In this first tutorial, we will set up the fundamental structure for your monorepo. Keeping everything in a single repository makes it easier to manage shared configurations, deployments, and overall project context.

## Prerequisites

- `just` command runner installed

## Step 1: Installing Git

If you don't already have Git installed, you can install it using your system's package manager:

- **Mac:** Open terminal and run `xcode-select --install`, or use Homebrew: `brew install git`.
- **Windows:** Download the Git for Windows installer from [git-scm.com](https://git-scm.com/).
- **Linux:** Run `sudo apt-get install git` (Ubuntu/Debian) or `sudo dnf install git` (Fedora).

## Step 2: Creating a GitHub Account

To host your code remotely, you'll need a GitHub account. 

1. Go to [github.com](https://github.com/) and click "Sign up".
2. Follow the prompts to create your account.
3. Click the "+" icon in the top right, select "New repository", name it `application-cms`, and create it.

## Step 3: Setting up an SSH Key

An SSH key allows you to push/pull code securely without entering your password every time.

1. Open your terminal and generate a new key:
   ```bash
   ssh-keygen -t ed25519 -C "your_email@example.com"
   ```
2. Press Enter to accept the default file location and enter a secure passphrase.
3. Start the SSH agent and add your key:
   ```bash
   eval "$(ssh-agent -s)"
   ssh-add ~/.ssh/id_ed25519
   ```
4. Copy your public key to the clipboard:
   - **Mac:** `pbcopy < ~/.ssh/id_ed25519.pub`
   - **Windows:** `clip < ~/.ssh/id_ed25519.pub`
   - **Linux:** `xclip -sel clip < ~/.ssh/id_ed25519.pub`
5. Go to GitHub **Settings** > **SSH and GPG keys** > **New SSH key**. Paste the key and save.

## Step 4: Initialize the Monorepo

Now we can create a new directory for your project and initialize Git:

```bash
mkdir application-cms
cd application-cms
git init
```

## Step 5: Add a Root Workspace File

Since we have multiple environments (marketing, client, api), using a task runner like `just` is highly recommended. We will add specific commands to this file as we build out the sub-projects, but for now, let's create a base `justfile` at the root:

```just
default:
    just --list
```

This ensures that running `just` without arguments will simply print out the available commands once we add them.

## Next Steps

With the root repository initialized, we are ready to set up the infrastructure for our media assets.

Proceed to [Tutorial 2: Cloudflare R2 Storage Integration](./02-cloudflare-r2-storage-integration.md).
