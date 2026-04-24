# gitdeploy

Lightweight auto-deploy webhook for [Dokku](https://github.com/dokku/dokku). Push to GitHub → your app rebuilds and deploys automatically.

## How It Works

```
GitHub (push) → gitdeploy (webhook receiver) → SSH to host → dokku git:sync --build
```

1. You push a commit to GitHub
2. GitHub sends a webhook POST to gitdeploy
3. gitdeploy looks up the repo in `APP_MAP` to find the Dokku app name
4. SSHes into the host and runs `dokku git:sync <app> <repo-url> --build`
5. Dokku pulls the latest code, builds, and deploys

## Features

- **Multi-app** — one gitdeploy instance handles any number of Dokku apps
- **Simple config** — one `APP_MAP` environment variable maps repos to apps
- **No database** — no Redis, no PostgreSQL, just a JSON config
- **Webhook signature verification** — optional HMAC-SHA256 validation
- **Auto HTTPS → SSH conversion** — converts GitHub HTTPS clone URLs to SSH for `git:sync`
- **Lightweight** — single Docker container, ~50MB RAM

## Quick Start

### 1. Build and Deploy

```bash
# Clone the repo
git clone https://github.com/kgrsajid/gitdeploy.git
cd gitdeploy

# Create Dokku app
dokku apps:create gitdeploy
dokku domains:add gitdeploy gitdeploy.yourdomain.com
dokku builder:set gitdeploy selected dockerfile

# Set environment variables
dokku config:set gitdeploy \
  APP_MAP='{"owner/repo1":"app1","owner/repo2":"app2"}' \
  DEPLOY_HOST=172.17.0.1 \
  DEPLOY_USER=openclaw

# Deploy
git remote add dokku dokku@your-server:gitdeploy
git push dokku main

# Add SSL (self-signed works with Cloudflare Full mode)
openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
  -keyout /tmp/gitdeploy.key -out /tmp/gitdeploy.crt \
  -subj "/CN=gitdeploy.yourdomain.com" \
  -addext "subjectAltName=DNS:gitdeploy.yourdomain.com"
cd /tmp && tar cvf gitdeploy-certs.tar gitdeploy.crt gitdeploy.key
dokku certs:add gitdeploy < /tmp/gitdeploy-certs.tar
```

### 2. Set Up SSH Key (container → host)

The container needs SSH access to the host to run dokku commands:

```bash
# Generate a key pair (on the server)
ssh-keygen -t ed25519 -f /tmp/deploy_key -N ""

# Add the public key to the host's authorized_keys
cat /tmp/deploy_key.pub >> ~/.ssh/authorized_keys

# Copy the private key into the container
docker cp /tmp/deploy_key gitdeploy.web.1:/app/deploy_key
docker exec gitdeploy.web.1 chmod 600 /app/deploy_key
```

### 3. Add GitHub Webhooks

For each repo you want to auto-deploy, add a webhook:

- **URL:** `https://gitdeploy.yourdomain.com/webhook`
- **Content type:** `application/json`
- **Secret:** (optional) set `WEBHOOK_SECRET` env var on gitdeploy and use the same value in GitHub
- **Events:** `Just the push event`

### 4. Add GitHub SSH Access for git:sync

Dokku needs to pull from private repos via SSH:

```bash
# On the Dokku server, add the deploy key
sudo dokku ssh-keys:add github-deploy < /path/to/your/github_deploy_key.pub
```

## Configuration

All config via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_MAP` | `{}` | JSON mapping `"owner/repo":"dokku-app-name"` |
| `DEPLOY_HOST` | `172.17.0.1` | Host to SSH into (Docker bridge gateway) |
| `DEPLOY_USER` | `openclaw` | SSH user on the host |
| `DEPLOY_KEY` | `/app/deploy_key` | Path to SSH private key inside container |
| `WEBHOOK_SECRET` | _(none)_ | GitHub webhook secret (disables verification if empty) |
| `PORT` | `5000` | Listen port |

### APP_MAP Examples

```bash
# Single app
dokku config:set gitdeploy APP_MAP='{"myuser/myapp":"myapp"}'

# Multiple apps
dokku config:set gitdeploy \
  APP_MAP='{"myuser/frontend":"web","myuser/api":"backend","myuser/worker":"worker"}'

# Mixed owner repos
dokku config:set gitdeploy \
  APP_MAP='{"org1/repo1":"app1","org2/repo2":"app2"}'
```

## API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Status check, shows configured apps |
| `POST` | `/webhook` | GitHub webhook endpoint |
| `POST` | `/` | Alias for `/webhook` |

## Why Not Use Dokku's Built-in Git Receive?

Dokku's `git push dokku main` requires shell access or a CI runner for each repo. gitdeploy works with **any** GitHub repo — just add a webhook, no CI pipeline needed. One container handles all your apps.

## Requirements

- Dokku server with SSH access
- Docker (for the container)
- GitHub account (for webhooks)

## License

MIT
