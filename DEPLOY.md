# Moonlit Production Deploy (nginx + HTTPS + firewall)

> Run this in the Alibaba Cloud Workbench terminal. The server runs
> Alibaba Cloud Linux 3 (commands below are for it, not the Ubuntu `ufw` set).

## 0. Update the code

```bash
cd ~/tarot-site
# download the new deploy zip (ask Sunny for the link), overwrite:
unzip -o <new-package>.zip
npm install
pm2 restart moonlit
```

## 1. Install nginx (reverse proxy)

```bash
sudo dnf install -y nginx
sudo systemctl enable --now nginx
```

`/etc/nginx/conf.d/moonlit.conf`:

```nginx
# HTTP -> HTTPS redirect
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate     /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # security headers (helmet already adds some at the app layer)
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # request body cap, matches the backend's 200kb limit
    client_max_body_size 200k;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

> The backend sets `trust proxy: loopback`, so it only trusts
> `X-Forwarded-For` from the local nginx — rate limiting sees the
> visitor's real IP.

## 2. HTTPS (free certificate)

```bash
sudo dnf install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
# enter your email when asked, accept the prompts;
# certbot rewrites the nginx config and auto-renews.
```

## 3. Firewall: only 22 / 80 / 443

```bash
# firewalld (OS level)
sudo systemctl enable --now firewalld
sudo firewall-cmd --permanent --add-service=ssh
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

Also in the **Alibaba Cloud console → ECS → Security Groups**, inbound rules
should only allow `22 (SSH)`, `80 (HTTP)`, `443 (HTTPS)`.
Do NOT expose Node's port 3000 to the public — it only talks to local nginx.

## 4. PM2 production mode

```bash
# ecosystem.config.js is already in the project root (optional)
pm2 start ecosystem.config.js   # or: NODE_ENV=production pm2 start backend/server.js --name moonlit
pm2 save
pm2 startup   # run the command it prints once, for reboot persistence
```

## 5. Email verification (QQ SMTP, free)

Registration requires email verification, sent from your QQ mailbox.
Enable SMTP in QQ Mail first:

1. Log in to QQ Mail web → **Settings** (设置) → **Accounts** (账号) →
   find **POP3/IMAP/SMTP/Exchange/CardDAV** → enable **SMTP**
   (phone verification required) → **Generate authorization code** → copy it
2. On the server, edit `.env`:
   ```
   SMTP_USER=your-qq-number@qq.com
   SMTP_PASS=the-authorization-code-you-just-copied (NOT your QQ password!)
   ```
   then `npm install` (new dependency: nodemailer) + `pm2 restart moonlit`

QQ Mail's free tier sends hundreds of emails a day — plenty for
verification codes. Without these two keys the site still runs
(codes go to the server console in dev mode, handy for testing),
but configure them before launch.

## 6. Pre-launch checklist

- [ ] `ADMIN_TOKEN` is set in `.env` (without it, all admin APIs return 503)
- [ ] `PAYMENTS_ENABLED=false` (keep charging off until ready)
- [ ] Before enabling payments: verify a real small-amount XorPay order
      passes callback signature verification
- [ ] `curl -I https://your-domain.com` shows no `x-powered-by` header
- [ ] Walk through in an incognito window: reading → register →
      logout → login; history is intact

---

中文版：[DEPLOY.zh-CN.md](DEPLOY.zh-CN.md)
