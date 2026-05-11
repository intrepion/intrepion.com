# Tutorial 2: SSH Key Configuration

An SSH key allows you to push and pull code securely from GitHub without entering your username and password every single time.

## Step 1: Generating an SSH Key

1. Open your terminal and generate a new key by replacing the email below with your GitHub email:
   ```bash
   ssh-keygen -t ed25519 -C "your_email@example.com"
   ```
2. When prompted to "Enter a file in which to save the key", simply press **Enter** to accept the default file location.
3. Next, you will be asked to enter a passphrase. Type a secure passphrase (or leave it blank) and press Enter.

## Step 2: Adding the Key to the SSH Agent

Start the SSH agent in the background and add your newly created key:

```bash
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519
```

## Step 3: Adding the Key to GitHub

We need to copy the *public* portion of the key to GitHub. Run the following command to copy the key to your clipboard:

- **Mac:** `pbcopy < ~/.ssh/id_ed25519.pub`
- **Windows:** `clip < ~/.ssh/id_ed25519.pub`
- **Linux:** `xclip -sel clip < ~/.ssh/id_ed25519.pub`

Next, open GitHub in your browser:
1. Go to **Settings** (click your profile picture in the top right).
2. Click on **SSH and GPG keys** in the left sidebar.
3. Click the **New SSH key** button.
4. Give it a descriptive title (e.g., "My Macbook").
5. Paste your key into the "Key" field and click **Add SSH key**.

## Next Steps

With your secure connection established, we can finally create our project folder locally.

Proceed to [Tutorial 3: Repository Setup & Infrastructure](./03-repository-setup-and-infrastructure.md).
