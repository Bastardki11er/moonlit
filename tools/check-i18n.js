// Checks i18n coverage: every t('key') in frontend JS and every
// data-i18n*="key" in frontend HTML must exist in the built dict,
// and reports dict keys that nothing references.
// Dynamic lookups like t("app.gallery.group_" + g.key) are declared
// in DYNAMIC_PREFIXES so the checker understands them.
// Usage: node tools/build-i18n.js && node tools/check-i18n.js
const fs = require("fs");
const path = require("path");

const fe = path.join(__dirname, "..", "frontend");
const dictSrc = fs.readFileSync(path.join(fe, "js", "i18n-dict.js"), "utf8");

const dictKeys = new Set();
for (const m of dictSrc.matchAll(/"((?:html|app|div|growth)\.[^"]+)":/g)) dictKeys.add(m[1]);

// Static prefixes used in dynamic lookups (verified by hand against the call sites).
// Any dict key starting with one of these counts as "used".
const DYNAMIC_PREFIXES = [
  "app.gallery.group_",    // t("app.gallery.group_" + g.key)
  "app.cards.suit_",       // suitName(): t("app.cards.suit_" + suit)
  "app.spread.",           // spreadPosName(): t("app.spread." + spreadKey + ".position_" + i)
  "html.spread.",          // spreadDisplayName(): t("html.spread." + r.spread_key + ".name")
  "div.view.",             // t(VIEW_TITLES[kind])
  "div.journal.kind_",      // kindLabel(): t(KIND_LABEL[k])
  "div.journal.mood_",      // t(MOOD_I18N[m])
  "growth.horo.sign_",     // t(SIGN_KEYS[i])
  "growth.horo.dim_",      // t(DIM_KEYS[d.k])
  "growth.onboard.intent_",// t("growth.onboard.intent_" + ...)
  "growth.onboard.q_",     // t("growth.onboard.q_" + ...)
  "growth.horo.f_",        // horoscope fortune lines t("growth.horo.f_" + ...)
  "growth.horo.color_",    // t(f.color) where f.color = "growth.horo.color_" + ...
  "app.daily.fortune_",     // daily fortune rotation: t("app.daily.fortune_" + (dayOfYear % 8))
];

const used = new Set();
const dynamicSeen = new Set();
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "cards") continue; // static SEO pages stay Chinese-only
      walk(p);
      continue;
    }
    if (p.endsWith(".js") && !p.endsWith("i18n-dict.js") && !p.endsWith(`${path.sep}i18n.js`)) {
      const src = fs.readFileSync(p, "utf8");
      // Collect every string literal inside each t(...) call (handles
      // ternaries like t(c ? "a.x" : "a.y")). A literal followed by +
      // is a dynamic prefix, not a full key.
      for (const m of src.matchAll(/\bt\(/g)) {
        let i = m.index + 2, depth = 1, lit = null, quote = null;
        const lits = [];
        while (i < src.length && depth > 0) {
          const ch = src[i];
          if (quote) {
            if (ch === "\\") { i += 2; continue; }
            if (ch === quote) { lits.push({ text: lit, dynamic: /^\s*\+/.test(src.slice(i + 1, i + 4)) }); quote = null; }
            else lit += ch;
          } else if (ch === '"' || ch === "'") { quote = ch; lit = ""; }
          else if (ch === "(") depth++;
          else if (ch === ")") depth--;
          i++;
        }
        for (const l of lits) {
          if (/^(html|app|div|growth)\./.test(l.text)) {
            if (l.dynamic) dynamicSeen.add(l.text);
            else used.add(l.text);
          }
        }
      }
    } else if (p.endsWith(".html") && !p.includes(`${path.sep}cards${path.sep}`)) {
      const src = fs.readFileSync(p, "utf8");
      for (const m of src.matchAll(/data-i18n(?:-ph|-html|-aria|-title)?="([^"]+)"/g)) used.add(m[1]);
    }
  }
};
walk(fe);

const isDynamicUsed = (k) => DYNAMIC_PREFIXES.some((pre) => k.startsWith(pre));

let fail = 0;
// 1. Every literal key must exist in the dict.
for (const k of used) {
  if (!dictKeys.has(k)) {
    console.log("MISSING KEY: " + k);
    fail = 1;
  }
}
// 2. Every dynamic prefix seen in code must be a declared, valid prefix,
//    and at least one dict key must actually use it (guards against typos).
for (const pre of dynamicSeen) {
  if (!DYNAMIC_PREFIXES.includes(pre)) {
    console.log("UNDECLARED DYNAMIC PREFIX: " + pre);
    fail = 1;
  } else if (![...dictKeys].some((k) => k.startsWith(pre))) {
    console.log("DYNAMIC PREFIX WITH NO KEYS: " + pre);
    fail = 1;
  }
}
// 3. Report dict keys nothing references (dynamic prefixes count as used).
for (const k of dictKeys) {
  if (!used.has(k) && !isDynamicUsed(k) && k !== "html.meta.title" && k !== "html.meta.description") {
    console.log("UNUSED KEY: " + k);
    fail = 1;
  }
}
console.log(fail ? "CHECK FAILED" : "CHECK PASSED — " + used.size + " literal keys, " + dictKeys.size + " in dict");
process.exit(fail);
