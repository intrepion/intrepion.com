# Tutorial 1: Git and GitHub Setup

Before we write any code, we need to ensure we can track our changes and back them up securely. We will use Git for version control and GitHub for hosting our remote repository.

## Step 1: Installing Git

If you don't already have Git installed, you can install it using your system's package manager:

- **Mac:** Open terminal and run `xcode-select --install`, or use Homebrew: `brew install git`.
- **Windows:** Download the Git for Windows installer from [git-scm.com](https://git-scm.com/).
- **Linux:** Run `sudo apt-get install git` (Ubuntu/Debian) or `sudo dnf install git` (Fedora).

To verify the installation, open your terminal and run:
```bash
git --version
```

## Step 2: Creating a GitHub Account

To host your code remotely, you'll need a GitHub account. 

1. Go to [github.com](https://github.com/) and click "Sign up".
2. Follow the prompts to create your account.
3. Once logged in, click the "+" icon in the top right, select "New repository", name it `application-cms`, and click "Create repository".

## Next Steps

Now that we have Git installed and a GitHub account ready, let's set up secure authentication so we don't have to type our password every time we push code.

Proceed to [Tutorial 2: SSH Key Configuration](./02-ssh-key-configuration.md).
