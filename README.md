# 🌙 Moonlit — AI Tarot Reading Website

A complete starter for an AI-powered tarot business. A visitor asks a question,
draws cards, and an AI (Muse or ChatGPT) writes a personal reading.

## Files

```
tarot-site/
├── frontend/
│   ├── index.html        # the page structure
│   ├── css/styles.css    # the mystical dark design
│   └── js/
│       ├── cards.js      # all 78 tarot cards + meanings (shared)
│       └── app.js        # shuffle, draw, flip, reading logic
├── backend/
│   └── server.js         # serves the site + talks to the AI securely
├── package.json          # Node.js dependencies
├── .env.example          # copy to .env, fill in your secrets
└── README.md             # this guide
```

## How it works (the big picture)

```
Visitor's browser              Your server                 AI company
 ┌─────────────┐   question   ┌──────────────┐   prompt   ┌──────────────┐
 │  frontend    │ ──────────▶ │  backend     │ ─────────▶ │ Doubao     │
 │  draws cards │              │  (key lives  │            │ writes the   │
 └─────────────┘              │   HERE only) │ ◀───────── │ reading      │
        ▲                     └──────────────┘  reading   └──────────────┘
        │  reading shown                │
        └───────────────────────────────┘
```

**The golden rule:** your API key lives ONLY on the backend (in `.env`).
Anyone can read frontend code, so a key there = anyone can spend your money.

## Run it on your computer

1. Install Node.js from https://nodejs.org (the LTS version).
2. Open a terminal in this folder:
   ```
   npm install
   cp .env.example .env
   ```
3. Get an AI key (5 minutes, see below) and paste it into `.env`.
4. In `frontend/js/app.js`, change `DEMO_MODE` to `false`.
5. Start it:
   ```
   npm start
   ```
6. Open http://localhost:3000 — ask a question, draw cards, get a real AI reading.

> Demo mode: with `DEMO_MODE = true`, the site works with sample readings
> and no key needed — good for testing the design.

## Get your AI API key (choose one)

**Doubao / 豆包 (ByteDance) — your pick: fast, great Chinese, super cheap**
1. Go to https://console.volcengine.com and sign up (火山引擎, needs 实名认证).
2. 开通豆包大模型, then 方舟 → API Key 管理 → create a key → copy it.
3. Add a few yuan of credit. ¥5 = roughly 3,000–5,000 readings.
4. Paste into `.env` as `DOUBAO_API_KEY`, set `AI_PROVIDER=doubao`.
   Model: `DOUBAO_MODEL=doubao-seed-1-6-250615`
   (or `doubao-seed-1-6-flash-250615` for even faster + cheaper).

**Muse (Anthropic) — backup option**
1. Go to https://console.anthropic.com and sign up.
2. "API keys" → create a key → copy it, add $5 of credit.
3. Paste into `.env` as `ANTHROPIC_API_KEY`, set `AI_PROVIDER=anthropic`.

**ChatGPT (OpenAI) — backup option**
1. Go to https://platform.openai.com, create a key, add credit.
2. Paste into `.env` as `OPENAI_API_KEY`, set `AI_PROVIDER=openai`.

## The money math (why this can profit)

| | Cost to you | You charge | Profit |
|---|---|---|---|
| 1 AI reading | ~¥0.01–0.05 | ¥9.9 / 10 readings | ~¥9.85 |
| 100 paying visitors | ~¥2 | ¥990 | ~¥985 |

Pricing: **¥9.9 once for 10 readings** (change with `PRICE_CNY` /
`READINGS_PER_PACK` in `.env`). Charging is OFF at first
(`PAYMENTS_ENABLED=false`) — flip it to `true` when you're ready.
The backend already limits free readings per day (`FREE_READINGS_PER_DAY`) —
after the free ones, it returns "payment required". That is where XorPay plugs in.

## 🚀 Real launch checklist — from zero to paying customers

All the code is DONE: site, AI backend, Stripe payments, paywall.
What is left is accounts + deploy — those need YOU, because they use
your identity and your money. Do them in this order:

### Step 1 — Doubao AI key (15 min, ~¥5)
1. Sign up at https://console.volcengine.com (火山引擎, needs 实名认证).
2. 开通豆包大模型, then go to 方舟 → API Key 管理 → create a key → copy it.
3. Add a few yuan of credit. Set a monthly spending cap while you learn.
4. You will paste it on the server in Step 3 — never into the code.

### Step 2 — Put the code on GitHub (10 min)
1. Create a free GitHub account, make a new repository (e.g. `moonlit-tarot`).
2. In this folder:
   ```
   git init
   git add .
   git commit -m "launch"
   git branch -M main
   git remote add origin YOUR-REPO-URL
   git push -u origin main
   ```
3. `.gitignore` already blocks `.env` — double-check it never uploads.

### Step 3 — Deploy on Render (20 min, free)
1. Sign up at https://render.com → New → Web Service → connect your repo.
2. Build command: `npm install` · Start command: `npm start`.
3. Add Environment Variables (same names as in `.env.example`):
   `AI_PROVIDER=doubao`, `DOUBAO_API_KEY`, `DOUBAO_MODEL`,
   `FREE_READINGS_PER_DAY`, `PRICE_CNY`, `READINGS_PER_PACK`,
   `XORPAY_AID`, `XORPAY_SECRET`,
   `BASE_URL` (= your Render URL, e.g. `https://moonlit.onrender.com`).
4. Deploy → open your URL. In `frontend/js/app.js` set `DEMO_MODE = false`,
   commit, push — Render redeploys automatically. Readings are now REAL AI.

### Step 4 — Take real payments with WeChat Pay / Alipay (when you're ready)
Charging is **OFF by default** — right now everyone gets unlimited free
readings, which is perfect for growing visitors first. When you want money,
do this (30 min). We use **XorPay** (https://xorpay.com) — it lets individuals accept
微信支付 and 支付宝 without a company license. Fee ~1.2%.
1. Sign up at https://xorpay.com.
2. 填写资料 → wait for 审核 → 扫码签约 to activate.
3. In the XorPay dashboard find your **aid** and **secret**.
4. Add to Render env vars: `XORPAY_AID`, `XORPAY_SECRET`.
5. `BASE_URL` must be your public HTTPS URL — XorPay calls
   `BASE_URL/api/xorpay-notify` after each payment, which credits the buyer
   with 10 readings automatically.
6. Test it: use up the free readings → paywall appears → pick 微信支付 →
   scan the QR with your phone → pay ¥9.9 → the reading appears. 🎉
7. If the QR code doesn't show on the first test, check your server logs —
   the raw XorPay response is logged and returned, so the QR field name
   can be adjusted in `extractQr()` in one edit.

### Step 5 — Your own domain (optional, ~$12/year)
Buy a name like `moonlitreadings.com` on Cloudflare → Render → Custom Domain →
follow the DNS steps. A real domain doubles trust.

### Step 6 — Get customers (this is the real job now)
- Post one 30-second "pick a card" video daily on TikTok + Instagram Reels.
  End every video: "want a reading about YOUR question? link in bio 🔮"
- Reply to comments with mini-readings to grow followers.
- Later: SEO blog posts ("tower card meaning in love") for Google traffic.

### The math, again
100 visitors/month paying ¥9.9 = ¥990 revenue, ~¥2 Doubao cost, ~¥12 XorPay
fees. Hosting is $0 (Render free tier) until traffic grows.
The business is traffic, not tech.

## Make the AI better (this is the real skill)

The magic is in `buildPrompt()` in `backend/server.js`. Try:
- Changing the reader's personality ("mysterious poet" vs "straight-talking coach").
- Asking for shorter/longer readings (`max_tokens`).
- Adding the visitor's name or birthday to the prompt for a personal touch.
- A/B test: which prompt makes people pay for a second reading?

## Get visitors (traffic = money)

- TikTok/Instagram: post 30-second "pick a card" readings daily — this niche
  does very well on short video.
- Each video ends with your site link: "want a reading about YOUR question?"
- SEO later: blog posts like "what does the Tower card mean in love?"

## ⚠️ Safety checklist

- [ ] `.env` is in `.gitignore`, never on GitHub
- [ ] Free-reading limit is on (stops bots draining your AI credit)
- [ ] Set a monthly spending cap in the AI provider's dashboard
- [ ] Add a disclaimer: readings are for fun/reflection, not professional advice

Have fun building. The code is yours — break it, change it, learn from it. 🌙
