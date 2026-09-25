# Moonlit 上线部署（nginx + HTTPS + 防火墙）

> 在阿里云 Workbench 里跑。服务器是 Alibaba Cloud Linux 3（命令按它写的，
> 不是 Ubuntu 那套 ufw）。

## 0. 先更新代码

```bash
cd ~/tarot-site
# 下载新的部署包（Sunny 会给你链接），解压覆盖
unzip -o tarot-site-security.zip
npm install          # 新增 helmet（纯 JS，无编译）
pm2 restart moonlit
```

⚠️ **注意**：这次修了一个老 bug——以前 `.env` 里 `ADMIN_TOKEN` 等变量
因为加载顺序问题根本没生效，一直用的是默认 token。
更新后你 `.env` 里设的 ADMIN_TOKEN **真正生效**了，
以后进 `/admin.html` 必须用你自己设的那个。

## 1. 装 nginx（反向代理）

```bash
sudo dnf install -y nginx
sudo systemctl enable --now nginx
```

`/etc/nginx/conf.d/moonlit.conf`：

```nginx
# HTTP 自动跳 HTTPS
server {
    listen 80;
    server_name 你的域名.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name 你的域名.com;

    ssl_certificate     /etc/letsencrypt/live/你的域名.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/你的域名.com/privkey.pem;

    # 安全头（应用层 helmet 已加了一部分，这里补全）
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # 上传/请求体上限，和后端 200kb 保持一致
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

> 后端已设 `trust proxy: loopback`，只信任本机 nginx 传来的
> `X-Forwarded-For`，限流拿到的 IP 是访客真实 IP。

## 2. HTTPS（免费证书）

```bash
sudo dnf install -y certbot python3-certbot-nginx
sudo certbot --nginx -d 你的域名.com
# 按提示输邮箱，一路回车/yes。certbot 会自动改 nginx 配置并续期。
```

## 3. 防火墙：只开 22 / 80 / 443

```bash
# firewalld（系统层面）
sudo systemctl enable --now firewalld
sudo firewall-cmd --permanent --add-service=ssh
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

另外去**阿里云控制台 → ECS → 安全组**，入方向只保留：
`22（SSH）`、`80（HTTP）`、`443（HTTPS）`。
Node 的 3000 端口**不要**放行到公网（只走本机 nginx）。

## 4. PM2 生产模式

```bash
# ecosystem.config.js（已在项目根目录，可选）
pm2 start ecosystem.config.js   # 或：NODE_ENV=production pm2 start backend/server.js --name moonlit
pm2 save
pm2 startup   # 按它输出的那行命令再跑一次，开机自启
```

## 5. 上线前检查单

- [ ] `.env` 里 `ADMIN_TOKEN` 已设（没设则后台接口全部 503）
- [ ] `PAYMENTS_ENABLED=false`（收费前保持关闭）
- [ ] 启用支付前：用一笔真实小额订单验证 XorPay 回调验签能通过
- [ ] `curl -I https://你的域名.com` 看不到 `x-powered-by`
- [ ] 无痕窗口走一遍：占卜 → 注册 → 退出 → 登录，记录都在
