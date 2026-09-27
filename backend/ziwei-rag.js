/* ============================================================
   Moonlit — ziwei RAG adapter (optional dataset enrichment)
   ------------------------------------------------------------
   If the open ziwei sample dataset (Renhuai123/ziwei-doushu,
   518,400 charts with interpretations — free for commercial use
   with attribution, see THIRD-PARTY-NOTICES.md) is downloaded into
   backend/data/ziwei-samples/, this module indexes it by life-palace major stars
   and returns similar-chart interpretation snippets as few-shot
   context for the AI. If the data isn't there, everything is a
   graceful no-op — the site works fine without it.

   Expected file layout (see tools/fetch-ziwei-samples.sh):
     backend/data/ziwei-samples/*.json
   Each JSON file holds one sample or an array of samples:
     { "chart": { ...命盘JSON... }, "readings": { "总览": "...", ... } }
   The loader is tolerant and also accepts the upstream shape
   { "命盘": {...}, "解读": {...} } with readings nested inside.
   ============================================================ */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data", "ziwei-samples");
const MAX_FILES = 20000;      // cap memory: index at most this many files
const MAX_SNIPPET = 600;      // chars of interpretation text per example

let index = null; // Map: "starA|starB" -> [snippet, ...]

function soulMajorStars(chartJson) {
  try {
    const palaces = chartJson["十二宫位"] || chartJson.palaces || [];
    const soul = palaces.find((p) => (p["宫位"] || p.name) === "命宫");
    if (!soul) return [];
    const majors = soul["主星及四化"] || soul.majorStars || [];
    return majors.map((s) => s["星名"] || s.name).filter(Boolean).sort();
  } catch (e) {
    return [];
  }
}

function extractReadings(sample) {
  // Accept several shapes; return { title: text } map.
  const cands = [
    sample.readings, sample["解读"], sample.interpretations,
    sample.chart && sample.chart.readings,
  ];
  for (const c of cands) {
    if (c && typeof c === "object") return c;
  }
  if (typeof sample["命格总览"] === "string") return { 总览: sample["命格总览"] };
  return null;
}

function extractChart(sample) {
  return sample.chart || sample["命盘"] || sample;
}

function buildIndex() {
  index = new Map();
  if (!fs.existsSync(DATA_DIR)) return;
  let files;
  try {
    files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json")).slice(0, MAX_FILES);
  } catch (e) {
    return;
  }
  for (const f of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf8"));
      const samples = Array.isArray(raw) ? raw : [raw];
      for (const s of samples) {
        const chart = extractChart(s);
        const readings = extractReadings(s);
        if (!readings) continue;
        const key = soulMajorStars(chart).join("|");
        if (!key) continue;
        const text = readings["总览"] || readings["命格总览"] || Object.values(readings)[0];
        if (typeof text !== "string" || !text.length) continue;
        if (!index.has(key)) index.set(key, []);
        const bucket = index.get(key);
        if (bucket.length < 5) bucket.push(text.slice(0, MAX_SNIPPET));
      }
    } catch (e) { /* skip bad files */ }
  }
  console.log(`   ziwei RAG: indexed ${index.size} star combinations from ${files.length} files` +
    (index.size ? "" : " (no usable samples — AI works without them)"));
}

/* Return up to k interpretation snippets from charts whose life-palace major stars
   match this chart's. Empty array when the dataset isn't installed. */
function findZiweiExamples(chartJson, k = 2) {
  if (index === null) buildIndex();
  if (!index || index.size === 0) return [];
  const key = soulMajorStars(chartJson).join("|");
  const bucket = index.get(key) || [];
  return bucket.slice(0, Math.max(1, Math.min(5, k)));
}

function ragStatus() {
  if (index === null) buildIndex();
  return { enabled: !!index && index.size > 0, combinations: index ? index.size : 0 };
}

module.exports = { findZiweiExamples, ragStatus };
