/* ============================================================
Moonlit — divination engines (bazi / ziwei / western astrology)
------------------------------------------------------------
Calculation is done by `taibu-core` (MIT licensed, free for
commercial use — see THIRD-PARTY-NOTICES.md). The chart text it
produces is fed to our AI for a Chinese interpretation, using
the same quota / history / auth plumbing as tarot readings.

Nothing from the client is trusted: birth data is validated in
validate.js, and the prompt only ever contains our own
calculated chart text plus the user's (length-capped) question.
============================================================ */

const { calculateBazi, toBaziText, toBaziJson} = require("taibu-core/bazi");
const { calculateZiwei, toZiweiText, toZiweiJson} = require("taibu-core/ziwei");
const { calculateAstrology, toAstrologyText, toAstrologyJson} = require("taibu-core/astrology");
const { findZiweiExamples} = require("./ziwei-rag");

/* ---------- chart calculation (pure, no AI) ---------- */

function calcBazi(input) {
const chart = calculateBazi(input);
return { json: toBaziJson(chart), text: toBaziText(chart)};
}

function calcZiwei(input) {
const chart = calculateZiwei(input);
return { json: toZiweiJson(chart), text: toZiweiText(chart)};
}

function calcAstro(input) {
const chart = calculateAstrology(input);
const natal = chart.natal || {};
// Raw geometry for the SVG wheel (toAstrologyJson drops decimals).
const extra = {
ascLon: (natal.angles || []).find((a) => a.key === "ascendant")?.position?.decimal ?? null,
bodies: (natal.bodies || []).map((b) => ({
key: b.key, label: b.label,
sign: (b.sign && b.sign.label) || "", house: b.house,
lon: (b.position && b.position.decimal) || 0,
degInSign: (b.position && b.position.withinSign) || "",
})),
houses: (natal.houses || []).map((h) => ({
id: h.id, label: h.label, startLon: (h.start && h.start.decimal) || 0,
sign: (h.sign && h.sign.label) || "",
})),
aspects: (chart.majorAspects || []).map((a) => ({
type: a.type, label: a.label,
from: a.from && a.from.key, to: a.to && a.to.key,
fromLabel: a.from && a.from.label, toLabel: a.to && a.to.label,
orb: a.orb,
})),
};
return { json: toAstrologyJson(chart), text: toAstrologyText(chart), extra };
}

/* ---------- AI prompts (Chinese, no "AI" wording on site) ---------- */

const NO_MEDICAL = "不要给医疗、法律、投资方面的具体建议，只做性格与运势层面的参考。";

/* Human-voice style for chart readings: a straight-talking master,
   zero AI tells, every judgment derived from the actual chart. */
const MASTER_ZH = `你是一位看了二十年命的老师傅，断命直来直去：好话直说，有坎儿也明说，但从不吓唬人、不卖弄术语，不说"命中有劫""大凶"这类唬人的词。说话像跟熟人唠嗑，大白话，听得懂最重要。你从不说自己是 AI。`;
const MASTER_EN = `You are a master who has read charts for twenty years — straight-talking: good news stated plainly, hard stretches named honestly, but never fear-mongering, never showing off jargon, never "doom" talk. You speak like chatting with an old acquaintance, in plain warm language. You never mention being an AI.`;
const CHART_VOICE_ZH = `文风铁律（逐条遵守）：
- 像真人发微信一样写：允许短句、反问、停顿；不许用"首先/其次/此外/综上所述/总而言之"，不许用数字编号或分点罗列，不许用小标题。
- 开头直接切入，不许寒暄（不许"亲爱的""你好呀"这类开场）。
- 每个判断都必须从命盘/星盘的具体组合推出来，禁止放之四海皆准的大道理和空洞的性格夸夸。
- 结尾不许"希望对你有帮助""祝你一切顺利"这类 AI 腔收尾，收尾要像人话。`;
const CHART_VOICE_EN = `House style (follow every rule):
- Write like texting a close friend: short sentences, rhetorical questions, pauses are fine. Never use "Firstly/Secondly/In conclusion", never use numbered or bulleted lists, never use subheadings.
- Get straight in — no greeting, no "Dear".
- Every judgment must be derived from a specific combination in the chart. No generic wisdom, no empty character praise.
- Never close with "I hope this helps" or "wishing you all the best" — end like a human would.`;

function buildDivinationPrompt(kind, chartText, question, lang) {
const en = lang === "en";
const q = question ? (en ? `The user especially wants to know: ${question}\n` : `用户还想特别了解：${question}\n`) : "";
if (en) {
const roleLine = kind === "bazi"
? "You are a master of Bazi (Four Pillars of Destiny) Chinese astrology, explaining the chart below in warm, plain English."
: kind === "ziwei"
? "You are a master of Zi Wei Dou Shu (Purple Star Astrology), explaining the chart below in warm, plain English."
: "You are an astrologer specializing in Western astrology, explaining the natal chart below in warm, plain English.";
const sections = kind === "ziwei"
? "personality & talents / career & wealth / love & marriage / major periods & yearly fortune"
: kind === "astro"
? "personality & talents / career & wealth / love & relationships / upcoming transits"
: "personality & talents / career & wealth / love & marriage / recent years' fortune";
return `${roleLine}
${q}Chart:
${chartText}

Write the reading in English (about 400-550 words):
- Open with one sentence naming the chart's defining trait, like the master's first-glance instinct.
- Then naturally cover ${sections}, without subheadings — transition the way people talk ("on the career front…", "love-wise…"). Each part needs at least one concrete judgment derived from a specific chart combination.
- Keep the original Chinese technical terms (e.g. 十神 names, 干支, star names like 紫微) and add a short English gloss in parentheses the first time each appears — then explain it in half a plain sentence, never a jargon pile.
${CHART_VOICE_EN}
No medical, legal, or investment advice — personality and fortune reference only.`;
}
if (kind === "bazi") {
return `${MASTER_ZH}
${q}命盘：
${chartText}

写一段八字解读（约 400-550 字）：
- 开头一句话点出这个命最关键的特点（日主、格局、用神），像老师傅第一眼看盘的直觉。
- 然后自然聊到性格天赋、事业财运、感情婚姻、近年运势四个方面，不用小标题，用"说到事业""感情上呢"这类话自然过渡；每方面至少有一个从命盘具体组合推出来的实在判断。
- 十神、干支这类术语第一次出现时，用半句大白话解释，别堆术语。
${CHART_VOICE_ZH}
${NO_MEDICAL}`;
}
if (kind === "ziwei") {
return `${MASTER_ZH}
${q}命盘：
${chartText}

写一段紫微解读（约 400-550 字）：
- 开头一句话点出命宫主星组合与格局，像老师傅第一眼看盘的直觉。
- 然后自然聊到性格天赋、事业财运、感情婚姻、大限流年四个方面，不用小标题，用"说到事业""感情上呢"这类话自然过渡；每方面至少有一个从星曜组合推出来的实在判断。
- 星曜宫位这类术语第一次出现时，用半句大白话解释，别堆术语。
${CHART_VOICE_ZH}
${NO_MEDICAL}`;
}
// astro
return `你是一位研究了二十年星盘的占星师，解盘直来直去：好话直说，有坎儿也明说，但从不吓唬人、不卖弄术语，不说"大凶"这类唬人的词。说话像跟熟人唠嗑，大白话，听得懂最重要。你从不说自己是 AI。
${q}星盘：
${chartText}

写一段星盘解读（约 400-550 字）：
- 开头一句话点出星盘的整体气质（太阳、月亮的组合），像占星师第一眼看盘的直觉。
- 然后自然聊到性格天赋、事业财运、感情关系、近期行运四个方面，不用小标题，用"说到事业""感情上呢"这类话自然过渡；每方面至少有一个从行星星座具体配置推出来的实在判断。
- 行星、星座、相位这类术语第一次出现时，用半句大白话解释，别堆术语。
${CHART_VOICE_ZH}
${NO_MEDICAL}`;
}

/* Build the full prompt for a divination reading, optionally enriched
with few-shot examples from the open ziwei sample dataset (RAG).
Returns { prompt, chartJson} — chartJson is stored for display. */
function buildReading(kind, input, question, lang) {
let calc;
if (kind === "bazi") calc = calcBazi(input);
else if (kind === "ziwei") calc = calcZiwei(input);
else calc = calcAstro(input);

let chartText = calc.text;
let ragNote = "";
if (kind === "ziwei") {
const examples = findZiweiExamples(calc.json, 2);
if (examples.length) {
ragNote = (lang === "en"
? "\n\nBelow are reading excerpts from charts with similar palace star combinations, for style reference only (do not copy):\n"
: "\n\n下面是命宫主星相似的命例解读片段，供你参考行文与断语风格（不要照搬）：\n") +
examples.map((e, i) => `${e}`).join("\n");
}
}
const prompt = buildDivinationPrompt(kind, chartText + ragNote, question, lang);
return { prompt, chartJson: calc.json, chartText, extra: calc.extra || null};
}

module.exports = { buildReading, buildDivinationPrompt, calcBazi, calcZiwei, calcAstro};
