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

function buildDivinationPrompt(kind, chartText, question) {
const q = question? `用户还想特别了解：${question}\n`: "";
if (kind === "bazi") {
return `你是一位精通八字命理的老师傅，用温暖、通俗的中文为用户解读下面这份八字命盘。
${q}要求：
1. 先一句话点评命局特点（日主、格局、用神）。
2. 分"性格天赋 / 事业财运 / 感情婚姻 / 近年运势"四段解读，每段 80-120 字。
3. 语言亲切自然，像真人师傅在说话，不要列干巴巴的术语表。
4. ${NO_MEDICAL}
5. 全文约 400-550 字，用中文。
6. 不要透露你是 AI，直接以命理师的口吻说话。

命盘：
${chartText}`;
}
if (kind === "ziwei") {
return `你是一位精通紫微斗数的老师傅，用温暖、通俗的中文为用户解读下面这份紫微命盘。
${q}要求：
1. 先一句话点评命宫主星组合与格局。
2. 分"性格天赋 / 事业财运 / 感情婚姻 / 大限流年"四段解读，每段 80-120 字。
3. 语言亲切自然，像真人师傅在说话，不要列干巴巴的术语表。
4. ${NO_MEDICAL}
5. 全文约 400-550 字，用中文。
6. 不要透露你是 AI，直接以命理师的口吻说话。

命盘：
${chartText}`;
}
// astro
return `你是一位精通西方占星的占星师，用温暖、通俗的中文为用户解读下面这份本命星盘。
${q}要求：
1. 先一句话点评星盘的整体气质（太阳、月亮、上升的组合）。
2. 分"性格天赋 / 事业财运 / 感情关系 / 近期行运"四段解读，每段 80-120 字。
3. 语言亲切自然，像真人占星师在说话，不要列干巴巴的术语表。
4. ${NO_MEDICAL}
5. 全文约 400-550 字，用中文。
6. 不要透露你是 AI，直接以占星师的口吻说话。

星盘：
${chartText}`;
}

/* Build the full prompt for a divination reading, optionally enriched
with few-shot examples from the open ziwei sample dataset (RAG).
Returns { prompt, chartJson} — chartJson is stored for display. */
function buildReading(kind, input, question) {
let calc;
if (kind === "bazi") calc = calcBazi(input);
else if (kind === "ziwei") calc = calcZiwei(input);
else calc = calcAstro(input);

let chartText = calc.text;
let ragNote = "";
if (kind === "ziwei") {
const examples = findZiweiExamples(calc.json, 2);
if (examples.length) {
ragNote =
"\n\n下面是命宫主星相似的命例解读片段，供你参考行文与断语风格（不要照搬）：\n" +
examples.map((e, i) => `${e}`).join("\n");
}
}
const prompt = buildDivinationPrompt(kind, chartText + ragNote, question);
return { prompt, chartJson: calc.json, chartText, extra: calc.extra || null};
}

module.exports = { buildReading, buildDivinationPrompt, calcBazi, calcZiwei, calcAstro};
