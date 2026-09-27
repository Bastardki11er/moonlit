# Deploying Moonlit

Run these in the Alibaba Cloud Workbench terminal. The box is Alibaba Cloud
Linux 3, so the commands below are for `dnf`/`firewalld`, not Ubuntu's `apt`/`ufw`.

## Updating the code

```bash
cd ~/tarot-site
unzip -o <new-package>.zip   # overwrite with the latest build
npm install
pm2 restart moonlit
```

## nginx as reverse proxy

```bash
sudo dnf install -y nginx
sudo systemctl enable --now nginx
```

Put this in `/etc/nginx/conf.d/moonlit.conf` (replace `your-domain.com`):

```nginx
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

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    client_max_body_size 200k;   # matches the backend's body limit

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

The backend trusts `X-Forwarded-For` only from localhost (`trust proxy:
loopback`), so rate limiting still sees the visitor's real IP.

## HTTPS

```bash
sudo dnf install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

Give it your email, accept the prompts. It rewrites the nginx config for you
and handles renewals.

## Firewall

Only 22/80/443 should be reachable:

```bash
sudo systemctl enable --now firewalld
sudo firewall-cmd --permanent --add-service=ssh
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

And in the cloud console (ECS → Security Groups), make sure inbound rules only
allow 22, 80, 443. Port 3000 stays internal — nginx is the only thing that
talks to Node.

## Keeping it alive

```bash
pm2 start ecosystem.config.js   # or: NODE_ENV=production pm2 start backend/server.js --name moonlit
pm2 save
pm2 startup   # run the command it prints, so it survives reboots
```

## Email verification

Registration requires an email code, sent from a QQ mailbox (free). One-time
setup in QQ Mail web: Settings → Accounts → enable SMTP → generate an
authorization code. Then on the server:

```
SMTP_USER=your-number@qq.com
SMTP_PASS=<the authorization code, NOT your QQ password>
```

followed by `npm install` (pulls in nodemailer) and `pm2 restart moonlit`.

QQ's free tier covers a few hundred emails a day — more than enough for
verification codes. Skip this and the site still runs; codes just get logged
to the console instead.

## Before you call it live

- `ADMIN_TOKEN` is set in `.env` (otherwise every admin API returns 503)
- `PAYMENTS_ENABLED=false` until you actually want to charge
- If you ever enable payments, run one real tiny XorPay order first and
  confirm the callback signature verifies
- `curl -I https://your-domain.com` shouldn't show `x-powered-by`
- Click through in an incognito window: reading → register → logout →
  login, history intact

