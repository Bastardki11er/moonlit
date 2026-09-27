# Moonlit

A tarot & fortune-telling website for Chinese-speaking users — live at https://moontarot.tech

I built this as a real product, not a demo. Visitors ask a question, draw cards,
and get a full reading written in Chinese by Doubao (ByteDance's LLM). There's
also BaZi charts, ZiWei charts, Western astrology, a daily almanac, and a
divination journal. The site UI is in Chinese — that's who it's for. Docs here
are in English.

## What's in it

- **Tarot**: 5 spreads (single card, love, career, money, Celtic Cross), each
  with its own card positions and reading angle. You can ask follow-up
  questions after a reading, and export the whole thing as a shareable image.
- **Charts**: BaZi (八字), ZiWei (紫微斗数), Western natal chart. I used to ask
  for birth coordinates; nobody knew theirs, so I dropped the location
  requirement entirely.
- **Daily stuff**: one-card-a-day, Chinese almanac (黄历), horoscopes for all
  12 signs, check-in streaks.
- **Accounts**: email + verification code login. Guests can use everything;
  their data merges into the account when they sign up, nothing gets lost.
- **Growth bits**: referral links, share-to-earn free readings, member perks
  (5 free readings/day etc.).
- 78 tarot card illustrations, all generated in the same moonlit style.

## How it's built

Plain Node + Express backend, vanilla JS/CSS frontend — no framework, it didn't
need one. SQLite for storage, but through sql.js (the WASM build): the native
sqlite3 module kept segfaulting on the server's old glibc and took the whole
app down with it, so I switched to the pure-JS version and never looked back.

Everything costs money except the code, so: rate limits on anything that hits
the AI, server-side prompt building (user input can't inject instructions into
readings), scrypt for passwords, and the usual helmet headers.

It runs on the cheapest Alibaba Cloud ECS box in Hong Kong, behind nginx with
a Let's Encrypt cert, kept alive by pm2. Payments (WeChat/Alipay via XorPay)
are wired up but switched off — free for everyone while I'm growing traffic.

## Run it yourself

```bash
npm install
cp .env.example .env   # fill in your keys
npm start               # http://localhost:3000
```

You need a Doubao API key (console.volcengine.com). A few yuan of credit lasts
a long time. Without email/SMTP keys it still runs — verification codes just
get printed to the console.

Deploy notes are in [DEPLOY.md](DEPLOY.md); third-party attributions in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

Chinese versions: [README.zh-CN.md](README.zh-CN.md), [DEPLOY.zh-CN.md](DEPLOY.zh-CN.md)
