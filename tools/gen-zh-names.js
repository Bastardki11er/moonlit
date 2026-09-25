#!/usr/bin/env node
/* ============================================================
   Moonlit — Chinese card-name map generator
   ------------------------------------------------------------
   Reads frontend/js/cards.js (78 cards) and writes
   frontend/js/card-names-zh.js:
     window.CARD_ZH_NAME = { "<id>": "<中文名>", ... }
     window.zhCardName(cardOrId) -> 中文名 (falls back to English)
   Run:  node tools/gen-zh-names.js
   ============================================================ */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const cards = require(path.join(ROOT, "frontend", "js", "cards.js"));

/* ---------- Chinese names (same logic as tools/gen-card-pages.js) ---------- */
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

const map = {};
for (const c of cards) map[c.id] = zhName(c);

const out =
  "/* ============================================================\n" +
  "   中文牌名映射 — 由 tools/gen-zh-names.js 生成，请勿手改\n" +
  "   ============================================================ */\n" +
  "window.CARD_ZH_NAME = " + JSON.stringify(map, null, 2) + ";\n\n" +
  "/** 中文牌名：传 card 对象或 id；找不到时回退英文名 */\n" +
  "window.zhCardName = function (cardOrId) {\n" +
  "  var id = typeof cardOrId === \"string\" ? cardOrId : (cardOrId && cardOrId.id);\n" +
  "  if (id && window.CARD_ZH_NAME[id]) return window.CARD_ZH_NAME[id];\n" +
  "  if (cardOrId && cardOrId.name) return cardOrId.name;\n" +
  "  return id || \"\";\n" +
  "};\n";

const outPath = path.join(ROOT, "frontend", "js", "card-names-zh.js");
fs.writeFileSync(outPath, out);
console.log("wrote", outPath, "—", Object.keys(map).length, "cards");
