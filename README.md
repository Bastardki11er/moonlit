# 🌙 Moonlit — Chinese Online Tarot & Divination Platform

**Live site:** https://moontarot.tech

Moonlit （月光塔罗） is a production divination platform for Chinese-speaking users:
themed tarot readings, BaZi / ZiWei / Western astrology charts, a daily almanac,
and a divination journal — all with AI-written interpretations in Chinese.
The product UI is in Chinese (that's the market); this README is in English.

## Features

**Tarot**
- 5 themed spreads, each with its own card positions and AI perspective:
  single-card guidance, romance, career, wealth, and the 10-card Celtic Cross
- Follow-up questions — the AI answers in the context of your spread
- Shareable reading images (canvas-rendered, with site QR code)
- 78 custom card illustrations, click-to-zoom lightbox, reversed cards shown rotated

**Chinese metaphysics**
- BaZi （八字） chart, ZiWei （紫微斗数） chart (computed with `taibu-core`),
  Western natal chart (SVG, no birth location required)
- Daily Chinese almanac （黄历： auspicious/inauspicious activities, clashes,
  wealth direction, hourly fortune)

**Engagement & growth**
- Daily card, daily check-in streaks, 12-sign daily horoscopes
- Referral program (`?ref=` links), share-to-earn free readings
- Registered-member perks: 5 free readings/day, saved birth profiles,
  100-reading history with cloud sync

**Accounts**
- Email + verification-code registration (QQ SMTP), scrypt password hashing
- Anonymous visitors keep their data; everything merges into the account on sign-up

## Tech stack

| Layer | Choice |
|---|---|
| Backend | Node.js + Express |
| Frontend | Vanilla JS + CSS (no framework) |
| Database | SQLite via **sql.js** (WASM — zero native compilation, survives glibc mismatches) |
| AI readings | Doubao (ByteDance) via Volcengine, 45s timeout, server-side prompt building |
| Payments | XorPay (WeChat Pay / Alipay) — currently **off**, everything free |
| Deploy | Alibaba Cloud ECS (Hong Kong), nginx reverse proxy, Let's Encrypt, pm2 |

## How it works

```
Visitor's browser              Your server                 AI provider
 ┌─────────────┐   question   ┌──────────────┐   prompt   ┌──────────────┐
 │  frontend    │ ──────────▶ │  backend     │ ─────────▶ │ Doubao     │
 │  draws cards │              │  (key lives  │            │ writes the   │
 └─────────────┘              │   HERE only) │ ◀───────── │ reading      │
        ▲                     └──────────────┘  reading   └──────────────┘
        │  reading shown                │
        └───────────────────────────────┘
```

**The golden rule:** API keys live ONLY on the backend (in `.env`, which is
git-ignored). Frontend code is public by definition — a key there is a key
given away.

## Project structure

```
tarot-site/
├── frontend/
│   ├── index.html            # home: daily card + feature tiles
│   ├── js/                   # cards.js (78 cards), app.js, divination.js,
│   │                         # card-names-zh.js (Chinese card names), ...
│   ├── img/cards/            # 78 custom card artworks (webp)
│   └── cards/                # 78 static SEO pages + sitemap.xml
├── backend/
│   ├── server.js             # Express API + static serving
│   ├── db.js                 # SQLite schema, accounts, readings, journals
│   ├── security.js           # rate limiting, admin brute-force protection
│   ├── validate.js           # input validation; card data rebuilt
│   │                         # server-side (kills prompt injection)
│   ├── email.js              # verification codes via QQ SMTP
│   ├── divination.js         # BaZi / ZiWei / star-chart calculations
│   └── ziwei-rag.js          # optional RAG over ZiWei samples (off by default)
├── tools/                    # tests (security, features), page generators
├── content-pack/             # social-media promo kit (not deployed)
├── ecosystem.config.js       # pm2 config
├── .env.example              # copy to .env and fill in
└── DEPLOY.md                 # production deploy runbook
```

## Run it locally

```bash
npm install
cp .env.example .env        # then fill in DOUBAO_API_KEY etc.
npm start                   # http://localhost:3000
```

Get a Doubao key at https://console.volcengine.com
(Ark → API key management). A few yuan of credit goes a long way.

## Configuration highlights (`.env`)

| Key | Meaning |
|---|---|
| `DOUBAO_API_KEY` / `DOUBAO_MODEL` | AI provider for readings |
| `FREE_READINGS_PER_DAY` / `FREE_READINGS_PER_DAY_MEMBER` | free quota: guests / members |
| `PAYMENTS_ENABLED` | `false` = everything free (current state) |
| `ADMIN_TOKEN` | password for the private admin dashboard |
| `SMTP_USER` / `SMTP_PASS` | QQ SMTP for verification emails |

## Security highlights

- Rate limits everywhere that costs money or leaks info
  (`/api/reading`: 30/hour/IP — protects the AI bill)
- Admin login: 10 wrong tokens / 10 min → IP banned for 1 hour
- AI prompts are built from **server-side card data only** —
  user input can't inject instructions into the reading
- helmet headers, no `x-powered-by`, 200 KB body limit
- Passwords hashed with scrypt; sessions are 32-byte tokens, 30-day expiry

## Deploy

See [DEPLOY.md](DEPLOY.md) — nginx + HTTPS + firewall on Alibaba Cloud.

## Third-party

See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
The 78 card illustrations were custom-made for Moonlit; all rights reserved.

---

中文版说明：[README.zh-CN.md](README.zh-CN.md) · 部署中文版：[DEPLOY.zh-CN.md](DEPLOY.zh-CN.md)
