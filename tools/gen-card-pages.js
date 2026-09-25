#!/usr/bin/env node
/* ============================================================
   Moonlit — SEO card page generator
   ------------------------------------------------------------
   Reads frontend/js/cards.js (78 cards) and generates one static,
   SEO-friendly HTML page per card at frontend/cards/<id>.html,
   plus frontend/sitemap.xml and frontend/robots.txt.

   BASE_URL: change this when you buy a domain name.
   Run:  node tools/gen-card-pages.js
   ============================================================ */

const fs = require("fs");
const path = require("path");

const BASE_URL = "http://8.217.3.14:3000"; // <-- replace with your domain later
const ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(ROOT, "frontend", "cards");

/* ---------- load card data ----------
   cards.js uses backslash-escaped quotes, so unescape first. */
function loadCards() {
  const src = fs
    .readFileSync(path.join(ROOT, "frontend", "js", "cards.js"), "utf8")
    .replace(/\\"/g, '"');
  const m = src.match(/const TAROT_CARDS = (\[[\s\S]*?\]);/);
  if (!m) throw new Error("TAROT_CARDS not found in cards.js");
  return eval(m[1]); // local build script — cards.js is our own file
}

/* ---------- Chinese names ---------- */
const MAJOR_ZH = {
  "major-0": "愚者", "major-1": "魔术师", "major-2": "女祭司",
  "major-3": "女皇", "major-4": "皇帝", "major-5": "教皇",
  "major-6": "恋人", "major-7": "战车", "major-8": "力量",
  "major-9": "隐者", "major-10": "命运之轮", "major-11": "正义",
  "major-12": "倒吊人", "major-13": "死神", "major-14": "节制",
  "major-15": "恶魔", "major-16": "高塔", "major-17": "星星",
  "major-18": "月亮", "major-19": "太阳", "major-20": "审判",
  "major-21": "世界",
};
const SUIT_ZH = { wands: "权杖", cups: "圣杯", swords: "宝剑", pentacles: "星币" };
const RANK_ZH = {
  ace: "一", 2: "二", 3: "三", 4: "四", 5: "五", 6: "六", 7: "七",
  8: "八", 9: "九", 10: "十", page: "侍从", knight: "骑士",
  queen: "王后", king: "国王",
};

function zhName(card) {
  if (card.arcana === "major") return MAJOR_ZH[card.id] || card.name;
  const suit = SUIT_ZH[card.suit] || card.suit;
  const rank = card.id.split("-")[1];
  return suit + (RANK_ZH[rank] || rank);
}
function arcanaLabel(card) {
  return card.arcana === "major" ? "大阿卡纳" : SUIT_ZH[card.suit] || "小阿卡纳";
}

/* ---------- global order: majors 0-21, then each suit ace..king ---------- */
const SUIT_ORDER = ["wands", "cups", "swords", "pentacles"];
const RANK_ORDER = ["ace", "2", "3", "4", "5", "6", "7", "8", "9", "10",
  "page", "knight", "queen", "king"];
function sortKey(card) {
  if (card.arcana === "major") return [0, card.number];
  return [1 + SUIT_ORDER.indexOf(card.suit),
    RANK_ORDER.indexOf(card.id.split("-")[1])];
}
function ordered(cards) {
  return [...cards].sort((a, b) => {
    const ka = sortKey(a), kb = sortKey(b);
    return ka[0] - kb[0] || ka[1] - kb[1];
  });
}

/* ---------- helpers ---------- */
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function short(s, n) {
  s = String(s);
  return s.length > n ? s.slice(0, n) : s;
}

/* ---------- page template ---------- */
function buildPage(card, zh, prev, next, related) {
  const label = arcanaLabel(card);
  const numLabel = card.arcana === "major" ? `大阿卡纳 · ${card.number}` : `小阿卡纳 · ${label}`;
  const canonical = `${BASE_URL}/cards/${card.id}.html`;
  const imgAbs = `${BASE_URL}/img/cards/${card.id}.webp`;
  const title = `${zh} ${card.name} 塔罗牌含义_正位逆位详解 | 月光塔罗`;
  const desc =
    `${zh}(${card.name})塔罗牌含义详解：正位${short(card.upright, 14)}；` +
    `逆位${short(card.reversed, 14)}。月光塔罗AI免费在线占卜。`;
  const keywords =
    `${zh},${card.name},塔罗牌${zh},塔罗牌含义,${zh}正位,${zh}逆位,${label}牌义,月光塔罗,在线占卜`;

  const relLinks = related.map((r) => `
      <a class="rel-card" href="/cards/${r.id}.html">
        <img src="../img/cards/${r.id}.webp" alt="${esc(r.zh)}塔罗牌含义" loading="lazy" width="120" height="180" />
        <span>${esc(r.zh)}</span>
      </a>`).join("");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}" />
<meta name="keywords" content="${esc(keywords)}" />
<link rel="canonical" href="${canonical}" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="月光塔罗" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(desc)}" />
<meta property="og:url" content="${canonical}" />
<meta property="og:image" content="${imgAbs}" />
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Georgia, "Times New Roman", "Songti SC", serif;
    background: #0d0b1a; color: #e8e4f5; min-height: 100vh; }
  .stars { position: fixed; inset: 0; pointer-events: none; opacity: .7;
    background-image:
      radial-gradient(1px 1px at 12% 22%, #fff 50%, transparent 51%),
      radial-gradient(1px 1px at 68% 8%, #fff 50%, transparent 51%),
      radial-gradient(1.5px 1px at 84% 34%, #fff 50%, transparent 51%),
      radial-gradient(1px 1px at 32% 66%, #fff 50%, transparent 51%),
      radial-gradient(1px 1px at 55% 82%, #fff 50%, transparent 51%); }
  .wrap { max-width: 960px; margin: 0 auto; padding: 0 18px 60px; position: relative; }
  .site-head { display: flex; justify-content: space-between; align-items: center;
    padding: 18px 0; border-bottom: 1px solid #2c2760; }
  .logo { color: #f0d98c; font-size: 20px; text-decoration: none; letter-spacing: 2px; }
  .site-head nav a { color: #9a94b8; text-decoration: none; font-size: 14px; margin-left: 16px; }
  .site-head nav a:hover { color: #d4af37; }
  .crumbs { font-size: 13px; color: #9a94b8; margin: 18px 0; }
  .crumbs a { color: #9a94b8; text-decoration: none; }
  .crumbs a:hover { color: #d4af37; }
  .card-page { display: grid; grid-template-columns: 300px 1fr; gap: 36px;
    background: #171431; border: 1px solid #2c2760; border-radius: 18px;
    padding: 32px; margin-top: 8px; }
  @media (max-width: 720px) { .card-page { grid-template-columns: 1fr; } }
  .art img { width: 100%; aspect-ratio: 2/3; object-fit: cover; display: block;
    border-radius: 12px; border: 1px solid rgba(212,175,55,.5);
    box-shadow: 0 12px 40px rgba(0,0,0,.5), 0 0 24px rgba(212,175,55,.15); }
  .arcana-label { color: #d4af37; font-size: 13px; letter-spacing: 3px; margin-bottom: 8px; }
  h1 { font-size: 34px; margin: 0 0 6px; color: #f0d98c; font-weight: normal; letter-spacing: 4px; }
  h1 .en { display: block; font-size: 15px; letter-spacing: 1px; color: #9a94b8; margin-top: 6px; }
  .meaning { margin-top: 22px; }
  .meaning h2 { font-size: 17px; color: #d4af37; letter-spacing: 2px;
    border-bottom: 1px solid #2c2760; padding-bottom: 8px; font-weight: normal; }
  .meaning p { line-height: 2; font-size: 16px; color: #e8e4f5; }
  .cta { display: inline-block; margin-top: 26px; padding: 14px 34px;
    background: linear-gradient(135deg, #d4af37, #b8860b); color: #1a1430;
    font-size: 17px; font-weight: bold; text-decoration: none; border-radius: 999px;
    box-shadow: 0 6px 24px rgba(212,175,55,.35); transition: transform .2s; }
  .cta:hover { transform: translateY(-2px); }
  .prevnext { display: flex; justify-content: space-between; margin: 28px 0; gap: 12px; }
  .prevnext a { flex: 1; background: #171431; border: 1px solid #2c2760; color: #e8e4f5;
    text-decoration: none; border-radius: 12px; padding: 14px 18px; font-size: 15px; }
  .prevnext a:hover { border-color: #d4af37; }
  .prevnext .next { text-align: right; }
  .related h2 { color: #f0d98c; font-size: 19px; letter-spacing: 3px; font-weight: normal; }
  .rel-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
  @media (max-width: 560px) { .rel-grid { grid-template-columns: repeat(2, 1fr); } }
  .rel-card { background: #171431; border: 1px solid #2c2760; border-radius: 10px;
    overflow: hidden; text-decoration: none; transition: transform .2s, border-color .2s; }
  .rel-card:hover { transform: translateY(-3px); border-color: #d4af37; }
  .rel-card img { width: 100%; aspect-ratio: 2/3; object-fit: cover; display: block; }
  .rel-card span { display: block; text-align: center; font-size: 13px; color: #9a94b8;
    padding: 8px 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  footer { text-align: center; color: #9a94b8; font-size: 13px; margin-top: 48px;
    border-top: 1px solid #2c2760; padding-top: 22px; line-height: 1.9; }
  footer a { color: #d4af37; text-decoration: none; }
</style>
</head>
<body>
<div class="stars"></div>
<div class="wrap">
  <header class="site-head">
    <a class="logo" href="/">🌙 月光塔罗</a>
    <nav><a href="/#gallery">🖼 牌鉴</a><a href="/">🔮 占卜</a></nav>
  </header>

  <nav class="crumbs"><a href="/">首页</a> · <a href="/#gallery">牌鉴</a> · <span>${esc(zh)}</span></nav>

  <article class="card-page">
    <div class="art">
      <img src="../img/cards/${card.id}.webp" alt="${esc(zh)} ${esc(card.name)} 塔罗牌" width="480" height="720" />
    </div>
    <div class="info">
      <div class="arcana-label">${esc(numLabel)}</div>
      <h1>${esc(zh)}<span class="en">${esc(card.name)}</span></h1>
      <section class="meaning">
        <h2>🔮 正位含义</h2>
        <p>${esc(card.upright)}</p>
      </section>
      <section class="meaning">
        <h2>🌙 逆位含义</h2>
        <p>${esc(card.reversed)}</p>
      </section>
      <a class="cta" href="/">🔮 免费AI占卜</a>
    </div>
  </article>

  <nav class="prevnext">
    <a class="prev" href="/cards/${prev.id}.html">← 上一张 · ${esc(prev.zh)}</a>
    <a class="next" href="/cards/${next.id}.html">下一张 · ${esc(next.zh)} →</a>
  </nav>

  <section class="related">
    <h2>✨ 相关牌</h2>
    <div class="rel-grid">${relLinks}
    </div>
  </section>

  <footer>
    <p>🌙 月光塔罗 · 牌为你开门，路要你自己走。仅供娱乐与自我探索。<br />
    <a href="/#gallery">浏览全部 78 张牌</a> · <a href="/">免费 AI 占卜</a></p>
  </footer>
</div>
</body>
</html>
`;
}

/* ---------- related cards: nearest 4 in the same group ---------- */
function groupKey(card) {
  return card.arcana === "major" ? "major" : card.suit;
}
function relatedCards(card, list) {
  const idx = list.findIndex((c) => c.id === card.id);
  const gk = groupKey(card);
  const same = list.filter((c) => groupKey(c) === gk && c.id !== card.id);
  // nearest by position in global order (wrap around)
  same.sort((a, b) => {
    const ia = list.findIndex((c) => c.id === a.id);
    const ib = list.findIndex((c) => c.id === b.id);
    const da = Math.min(Math.abs(ia - idx), list.length - Math.abs(ia - idx));
    const db = Math.min(Math.abs(ib - idx), list.length - Math.abs(ib - idx));
    return da - db;
  });
  return same.slice(0, 4);
}

/* ---------- sitemap + robots ---------- */
function buildSitemap(ids) {
  const urls = [
    `  <url>\n    <loc>${BASE_URL}/</loc>\n    <changefreq>weekly</changefreq>\n    <priority>1.0</priority>\n  </url>`,
    ...ids.map((id) =>
      `  <url>\n    <loc>${BASE_URL}/cards/${id}.html</loc>\n` +
      `    <changefreq>monthly</changefreq>\n    <priority>0.8</priority>\n  </url>`),
  ].join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!-- 买了域名后，把下面所有的 ${BASE_URL} 换成你的域名，然后重新跑 node tools/gen-card-pages.js -->\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
function buildRobots() {
  return `User-agent: *\nAllow: /\n\nSitemap: ${BASE_URL}/sitemap.xml\n`;
}

/* ---------- main ---------- */
function main() {
  const cards = loadCards();
  const list = ordered(cards).map((c) => ({ ...c, zh: zhName(c) }));
  console.log(`Loaded ${list.length} cards.`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (let i = 0; i < list.length; i++) {
    const card = list[i];
    const prev = list[(i - 1 + list.length) % list.length];
    const next = list[(i + 1) % list.length];
    const related = relatedCards(card, list);
    fs.writeFileSync(
      path.join(OUT_DIR, `${card.id}.html`),
      buildPage(card, card.zh, prev, next, related),
      "utf8"
    );
  }
  console.log(`Wrote ${list.length} pages to frontend/cards/.`);

  fs.writeFileSync(
    path.join(ROOT, "frontend", "sitemap.xml"),
    buildSitemap(list.map((c) => c.id)), "utf8");
  fs.writeFileSync(
    path.join(ROOT, "frontend", "robots.txt"), buildRobots(), "utf8");
  console.log("Wrote frontend/sitemap.xml and frontend/robots.txt.");
}

main();
