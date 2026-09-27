/* ============================================================
   Moonlit — divination frontend (bazi / ziwei / astro / journal)
   ------------------------------------------------------------
   Tab navigation, birth-data forms, chart rendering (bazi pillars,
   ziwei 4x4 palace grid, western SVG chart wheel) and the reading
   journal. Works alongside js/app.js (tarot); shares its user id
   (localStorage moonlit_uid) and login token.
   ============================================================ */
(function () {
"use strict";

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
const uid = () => { try { return localStorage.getItem("moonlit_uid") || ""; } catch (e) { return ""; } };
function authHeaders() {
  try {
    const t = localStorage.getItem("moonlit_token");
    return t ? { Authorization: "Bearer " + t } : {};
  } catch (e) { return {}; }
}
async function api(path, opts) {
  opts = opts || {};
  const res = await fetch(path, {
    method: opts.method || "GET",
    headers: Object.assign({ "Content-Type": "application/json" }, authHeaders(), opts.headers || {}),
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "请求失败，请重试。");
  return data;
}
const para = (t) => esc(t).replace(/\n/g, "<br>");

/* ---------------- view tabs ---------------- */
const VIEW_TITLES = { home: "首页", tarot: "塔罗占卜", bazi: "八字排盘", ziwei: "紫微斗数", astro: "西方星盘", journal: "占卜日记" };
function switchView(name) {
  document.querySelectorAll("#topnav [data-view]").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === name));
  document.querySelectorAll(".view").forEach((v) => { v.hidden = v.id !== "view-" + name; });
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (name === "journal") loadJournal();
  if (name === "bazi") loadMiniHistory("bazi");
  if (name === "ziwei") loadMiniHistory("ziwei");
  if (name === "astro") loadMiniHistory("astro");
}
document.querySelectorAll("#topnav [data-view]").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

/* 首页功能磁贴 → 跳转到对应视图 */
document.querySelectorAll(".feature-tile[data-goto]").forEach((tile) => {
  tile.addEventListener("click", () => switchView(tile.dataset.goto));
});

/* ---------------- birth form ---------------- */
const SHICHEN = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];
const shichenOf = (h) => SHICHEN[Math.floor(((h + 1) % 24) / 2)];

/* 省/市两级：中式地址选择，每个城市带经纬度（用于真太阳时换算）。
   坐标为城市中心近似值，娱乐用途足够精确。 */
const PROVINCES = [
  ["北京市", [["北京市", 39.90, 116.40]]],
  ["天津市", [["天津市", 39.13, 117.20]]],
  ["河北省", [["石家庄", 38.04, 114.51], ["唐山", 39.63, 118.18], ["秦皇岛", 39.94, 119.59], ["邯郸", 36.61, 114.54], ["保定", 38.87, 115.46], ["沧州", 38.31, 116.84], ["廊坊", 39.54, 116.70], ["邢台", 37.07, 114.50]]],
  ["山西省", [["太原", 37.87, 112.55], ["大同", 40.08, 113.30], ["运城", 35.03, 111.01], ["长治", 36.19, 113.11], ["临汾", 36.09, 111.52]]],
  ["内蒙古自治区", [["呼和浩特", 40.84, 111.75], ["包头", 40.58, 109.83], ["鄂尔多斯", 39.61, 109.78], ["赤峰", 42.26, 118.89], ["通辽", 43.65, 122.24]]],
  ["辽宁省", [["沈阳", 41.80, 123.43], ["大连", 38.91, 121.61], ["鞍山", 41.11, 122.99], ["抚顺", 41.88, 123.96], ["锦州", 41.10, 121.13], ["营口", 40.67, 122.24]]],
  ["吉林省", [["长春", 43.89, 125.32], ["吉林市", 43.84, 126.56], ["延吉", 42.89, 129.51], ["四平", 43.17, 124.36]]],
  ["黑龙江省", [["哈尔滨", 45.80, 126.53], ["大庆", 46.59, 125.00], ["齐齐哈尔", 47.35, 123.96], ["佳木斯", 46.80, 130.32], ["牡丹江", 44.55, 129.63]]],
  ["上海市", [["上海市", 31.23, 121.47]]],
  ["江苏省", [["南京", 32.06, 118.80], ["苏州", 31.30, 120.62], ["无锡", 31.57, 120.30], ["常州", 31.78, 119.97], ["徐州", 34.20, 117.28], ["南通", 31.98, 120.89], ["扬州", 32.39, 119.41], ["盐城", 33.38, 120.16], ["镇江", 32.19, 119.43], ["泰州", 32.46, 119.93], ["淮安", 33.61, 119.02], ["连云港", 34.60, 119.22]]],
  ["浙江省", [["杭州", 30.27, 120.15], ["宁波", 29.88, 121.55], ["温州", 28.00, 120.70], ["绍兴", 30.03, 120.58], ["嘉兴", 30.75, 120.76], ["湖州", 30.89, 120.09], ["金华", 29.08, 119.65], ["台州", 28.66, 121.42], ["衢州", 28.97, 118.86], ["丽水", 28.47, 119.92], ["舟山", 29.99, 122.21]]],
  ["安徽省", [["合肥", 31.86, 117.28], ["芜湖", 31.35, 118.43], ["蚌埠", 32.92, 117.39], ["淮南", 32.63, 117.01], ["马鞍山", 31.67, 118.51], ["安庆", 30.53, 117.06], ["阜阳", 32.89, 115.81], ["滁州", 32.31, 118.32]]],
  ["福建省", [["福州", 26.08, 119.30], ["厦门", 24.48, 118.09], ["泉州", 24.87, 118.68], ["漳州", 24.51, 117.65], ["莆田", 25.43, 119.01], ["三明", 26.26, 117.64], ["南平", 26.64, 118.17], ["龙岩", 25.08, 117.02], ["宁德", 26.67, 119.55]]],
  ["江西省", [["南昌", 28.68, 115.86], ["九江", 29.71, 116.00], ["赣州", 25.83, 114.93], ["上饶", 28.45, 117.95], ["宜春", 27.82, 114.42], ["吉安", 27.11, 115.00], ["抚州", 27.98, 116.37]]],
  ["山东省", [["济南", 36.65, 117.12], ["青岛", 36.07, 120.38], ["烟台", 37.46, 121.45], ["潍坊", 36.71, 119.16], ["临沂", 35.10, 118.36], ["淄博", 36.81, 118.05], ["济宁", 35.42, 116.59], ["泰安", 36.20, 117.09], ["威海", 37.51, 122.12], ["日照", 35.42, 119.53], ["德州", 37.45, 116.31], ["聊城", 36.46, 115.99], ["菏泽", 35.24, 115.49]]],
  ["河南省", [["郑州", 34.75, 113.63], ["洛阳", 34.62, 112.45], ["开封", 34.80, 114.31], ["南阳", 33.00, 112.53], ["新乡", 35.30, 113.93], ["安阳", 36.10, 114.39], ["许昌", 34.03, 113.85], ["平顶山", 33.77, 113.31], ["信阳", 32.15, 114.10], ["商丘", 34.42, 115.67], ["焦作", 35.22, 113.24], ["周口", 33.63, 114.70], ["驻马店", 32.98, 114.03]]],
  ["湖北省", [["武汉", 30.59, 114.30], ["宜昌", 30.70, 111.28], ["襄阳", 32.01, 112.14], ["荆州", 30.34, 112.24], ["黄冈", 30.45, 114.87], ["孝感", 30.92, 113.92], ["咸宁", 29.84, 114.32], ["荆门", 31.04, 112.20], ["十堰", 32.63, 110.80], ["随州", 31.69, 113.38], ["恩施", 30.27, 109.49]]],
  ["湖南省", [["长沙", 28.23, 112.94], ["株洲", 27.83, 113.13], ["湘潭", 27.83, 112.93], ["衡阳", 26.90, 112.57], ["常德", 29.03, 111.70], ["岳阳", 29.37, 113.13], ["益阳", 28.55, 112.33], ["郴州", 25.77, 113.02], ["邵阳", 27.24, 111.47], ["怀化", 27.57, 110.00], ["娄底", 27.70, 112.00], ["永州", 26.42, 111.61], ["张家界", 29.13, 110.48]]],
  ["广东省", [["广州", 23.13, 113.26], ["深圳", 22.54, 114.06], ["珠海", 22.27, 113.58], ["佛山", 23.02, 113.12], ["东莞", 23.02, 113.75], ["中山", 22.52, 113.39], ["惠州", 23.11, 114.42], ["汕头", 23.35, 116.68], ["江门", 22.59, 113.08], ["湛江", 21.27, 110.36], ["茂名", 21.66, 110.93], ["肇庆", 23.05, 112.47], ["揭阳", 23.55, 116.37], ["梅州", 24.29, 116.12], ["汕尾", 22.78, 115.38], ["潮州", 23.66, 116.62], ["韶关", 24.81, 113.60], ["阳江", 21.86, 111.98], ["云浮", 22.92, 112.04], ["河源", 23.74, 114.70]]],
  ["广西壮族自治区", [["南宁", 22.82, 108.37], ["柳州", 24.33, 109.43], ["桂林", 25.27, 110.29], ["梧州", 23.48, 111.28], ["北海", 21.48, 109.12], ["玉林", 22.63, 110.18], ["钦州", 21.98, 108.65], ["贵港", 23.11, 109.60], ["百色", 23.90, 106.62], ["河池", 24.69, 108.06]]],
  ["海南省", [["海口", 20.02, 110.35], ["三亚", 18.25, 109.51], ["儋州", 19.52, 109.58], ["琼海", 19.24, 110.47]]],
  ["重庆市", [["重庆市", 29.56, 106.55], ["万州", 30.81, 108.38], ["涪陵", 29.70, 107.39]]],
  ["四川省", [["成都", 30.57, 104.07], ["绵阳", 31.47, 104.68], ["德阳", 31.13, 104.40], ["宜宾", 28.75, 104.65], ["南充", 30.84, 106.11], ["乐山", 29.55, 103.77], ["泸州", 28.87, 105.44], ["自贡", 29.34, 104.78], ["攀枝花", 26.59, 101.72], ["内江", 29.59, 105.06], ["遂宁", 30.53, 105.59], ["眉山", 30.08, 103.85], ["广安", 30.46, 106.63], ["达州", 31.21, 107.47], ["雅安", 29.98, 103.04], ["资阳", 30.13, 104.64], ["西昌", 27.90, 102.26]]],
  ["贵州省", [["贵阳", 26.65, 106.63], ["遵义", 27.73, 106.93], ["六盘水", 26.59, 104.83], ["安顺", 26.24, 105.95], ["毕节", 27.30, 105.29], ["铜仁", 27.73, 109.19], ["凯里", 26.57, 107.98], ["都匀", 26.27, 107.52]]],
  ["云南省", [["昆明", 25.04, 102.71], ["大理", 25.61, 100.27], ["丽江", 26.86, 100.23], ["曲靖", 25.49, 103.80], ["玉溪", 24.35, 102.55], ["昭通", 27.34, 103.72], ["保山", 25.11, 99.16], ["普洱", 22.83, 100.97], ["临沧", 23.88, 100.09], ["西双版纳", 22.01, 100.80], ["楚雄", 25.04, 101.55]]],
  ["西藏自治区", [["拉萨", 29.65, 91.10], ["日喀则", 29.27, 88.88], ["昌都", 31.14, 97.17], ["林芝", 29.65, 94.36], ["山南", 29.24, 91.77], ["那曲", 31.48, 92.05]]],
  ["陕西省", [["西安", 34.34, 108.94], ["宝鸡", 34.36, 107.24], ["咸阳", 34.33, 108.71], ["渭南", 34.50, 109.51], ["汉中", 33.07, 107.02], ["榆林", 38.29, 109.74], ["延安", 36.59, 109.49], ["安康", 32.68, 109.03], ["商洛", 33.87, 109.94]]],
  ["甘肃省", [["兰州", 36.06, 103.83], ["天水", 34.58, 105.72], ["白银", 36.55, 104.14], ["酒泉", 39.74, 98.49], ["张掖", 38.93, 100.45], ["武威", 37.93, 102.63], ["定西", 35.58, 104.63], ["陇南", 33.40, 104.92], ["平凉", 35.54, 106.67], ["庆阳", 35.71, 107.64]]],
  ["青海省", [["西宁", 36.62, 101.78], ["海东", 36.50, 102.10], ["海西", 37.38, 97.37], ["玉树", 33.00, 97.01]]],
  ["宁夏回族自治区", [["银川", 38.49, 106.23], ["石嘴山", 39.01, 106.38], ["吴忠", 37.99, 106.20], ["固原", 36.02, 106.24], ["中卫", 37.51, 105.19]]],
  ["新疆维吾尔自治区", [["乌鲁木齐", 43.83, 87.62], ["克拉玛依", 45.58, 84.87], ["吐鲁番", 42.95, 89.19], ["哈密", 42.85, 93.51], ["昌吉", 44.01, 87.30], ["阿克苏", 41.17, 80.26], ["喀什", 39.47, 75.99], ["和田", 37.11, 79.92], ["伊宁", 43.98, 81.32], ["塔城", 46.75, 82.98], ["阿勒泰", 47.85, 88.13]]],
  ["香港特别行政区", [["香港", 22.32, 114.17]]],
  ["澳门特别行政区", [["澳门", 22.20, 113.55]]],
  ["台湾省", [["台北", 25.03, 121.57], ["高雄", 22.62, 120.31], ["台中", 24.14, 120.68], ["台南", 22.99, 120.20], ["桃园", 24.99, 121.31], ["新竹", 24.80, 120.97], ["嘉义", 23.48, 120.45]]],
];

function hourOptions() {
  let s = '<option value="">请选择</option>';
  for (let h = 0; h < 24; h++) s += `<option value="${h}">${h}点（${shichenOf(h)}时）</option>`;
  return s;
}

function provinceOptions() {
  return PROVINCES.map((pr, i) => `<option value="${i}">${pr[0]}</option>`).join("");
}
function cityOptions(pi) {
  return PROVINCES[pi][1].map((c, i) => `<option value="${i}">${c[0]}</option>`).join("") +
    `<option value="custom">其他城市（手动填经纬度）</option>`;
}
/* 省/市两级联动 + "其他城市"时展开经纬度兜底 */
function wireLocationCascade(p) {
  const prov = $(p + "-province"), city = $(p + "-city"), wrap = $(p + "-llwrap");
  const refreshCities = () => {
    city.innerHTML = cityOptions(parseInt(prov.value, 10));
    wrap.hidden = true;
  };
  prov.addEventListener("change", refreshCities);
  city.addEventListener("change", () => { wrap.hidden = city.value !== "custom"; });
  refreshCities();
}

function birthFormHTML(p, opts) {
  opts = opts || {};
  return `
  <form id="${p}-form" class="birth-form" novalidate>
    <div class="form-row">
      <label class="form-label">性别</label>
      <div class="pill-group">
        <label class="pill"><input type="radio" name="${p}-gender" value="male" checked /><span>男</span></label>
        <label class="pill"><input type="radio" name="${p}-gender" value="female" /><span>女</span></label>
      </div>
    </div>
    <div class="form-row">
      <label class="form-label">出生日期</label>
      <div class="date-inputs">
        <input id="${p}-year" type="number" min="1900" max="2026" placeholder="年 · 如1995" />
        <input id="${p}-month" type="number" min="1" max="12" placeholder="月" />
        <input id="${p}-day" type="number" min="1" max="31" placeholder="日" />
      </div>
      <div class="pill-group" style="margin-top:8px">
        <label class="pill"><input type="radio" name="${p}-cal" value="solar" checked /><span>阳历</span></label>
        <label class="pill"><input type="radio" name="${p}-cal" value="lunar" /><span>农历</span></label>
        <label class="pill check"><input type="checkbox" id="${p}-leap" /><span>闰月</span></label>
      </div>
    </div>
    <div class="form-row">
      <label class="form-label">出生时间</label>
      <div class="date-inputs">
        <select id="${p}-hour">${hourOptions()}</select>
        <select id="${p}-minute">
          <option value="">分钟不详</option>
          <option value="0">00分</option><option value="15">15分</option>
          <option value="30" selected>30分</option><option value="45">45分</option>
        </select>
      </div>
    </div>
    ${opts.location ? `
    <div class="form-row">
      <label class="form-label">出生地</label>
      <div class="date-inputs">
        <select id="${p}-province">${provinceOptions()}</select>
        <select id="${p}-city"></select>
      </div>
      <div class="date-inputs" id="${p}-llwrap" hidden style="margin-top:8px">
        <input id="${p}-lat" type="number" step="0.01" placeholder="纬度，如 31.23" />
        <input id="${p}-lon" type="number" step="0.01" placeholder="经度，如 121.47" />
      </div>
    </div>` : ""}
    <div class="form-row">
      <label class="form-label">想重点了解 <span class="hint-inline">（可选）</span></label>
      <input id="${p}-question" maxlength="200" placeholder="比如：今年事业运如何？" />
    </div>
    <p class="form-error" id="${p}-error" hidden></p>
    <button type="submit" class="cta" id="${p}-submit">🔮 排出命盘</button>
    <p class="hint">排盘消耗 1 次免费额度 · 仅供娱乐与自我探索</p>
  </form>`;
}

function readBirthForm(p, opts) {
  opts = opts || {};
  const err = (m) => { const e = $(p + "-error"); e.textContent = m; e.hidden = false; throw new Error(m); };
  $(p + "-error").hidden = true;
  const gender = (document.querySelector(`input[name="${p}-gender"]:checked`) || {}).value;
  if (!gender) err("请选择性别。");
  const y = parseInt($(p + "-year").value, 10);
  const mo = parseInt($(p + "-month").value, 10);
  const d = parseInt($(p + "-day").value, 10);
  const h = $(p + "-hour").value === "" ? null : parseInt($(p + "-hour").value, 10);
  if (!y || !mo || !d) err("请填写完整的出生日期。");
  if (h === null) err("请选择出生时辰（大约几点）。");
  const body = {
    userId: uid(),
    gender,
    birthYear: y, birthMonth: mo, birthDay: d, birthHour: h,
    calendarType: (document.querySelector(`input[name="${p}-cal"]:checked`) || {}).value || "solar",
    isLeapMonth: $(p + "-leap").checked,
    question: $(p + "-question").value.trim(),
  };
  const min = $(p + "-minute").value;
  if (min !== "") body.birthMinute = parseInt(min, 10);
  if (opts.location) {
    const pi = parseInt($(p + "-province").value, 10);
    const ci = $(p + "-city").value;
    if (ci === "custom") {
      const lat = parseFloat($(p + "-lat").value), lon = parseFloat($(p + "-lon").value);
      if (!isFinite(lat) || !isFinite(lon)) err("请填写出生地的经纬度。");
      body.latitude = lat; body.longitude = lon; body.birthPlace = "自定义";
    } else {
      const prov = PROVINCES[pi], c = prov[1][parseInt(ci, 10)];
      body.latitude = c[1]; body.longitude = c[2];
      body.birthPlace = prov[0] === c[0] ? c[0] : prov[0].replace(/省|自治区|特别行政区|市$/, "") + "·" + c[0];
    }
  }
  return body;
}

/* ---------------- 出生信息记忆（注册用户专享） ---------------- */
const isLoggedIn = () => {
  try { return !!localStorage.getItem("moonlit_token"); } catch (e) { return false; }
};
let birthProfileCache = null; // null=未加载，false=无或游客

async function getBirthProfile() {
  if (birthProfileCache !== null) return birthProfileCache || null;
  if (!isLoggedIn()) { birthProfileCache = false; return null; }
  try {
    const d = await api("/api/profile/birth");
    birthProfileCache = d.profile || false;
  } catch (e) { birthProfileCache = false; }
  return birthProfileCache || null;
}

function initBirthMemory(p, opts) {
  opts = opts || {};
  const wrap = $(p + "-form-wrap");
  if (!wrap) return;
  let bar = $(p + "-memory-bar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = p + "-memory-bar";
    bar.className = "birth-memory-bar";
    bar.hidden = true;
    wrap.prepend(bar);
  }
  getBirthProfile().then((prof) => {
    if (prof) {
      bar.hidden = false;
      bar.innerHTML =
        `🎂 检测到你保存的出生信息 ` +
        `<button type="button" class="ghost small" id="${p}-fill-profile">⚡ 一键填入</button>`;
      const btn = $(p + "-fill-profile");
      if (btn) btn.addEventListener("click", () => fillBirthForm(p, prof, !!opts.location));
    } else if (!isLoggedIn()) {
      bar.hidden = false;
      bar.innerHTML = `<span class="hint">👑 登录后可记住出生信息，下次排盘一键填入</span>`;
    } else {
      bar.hidden = true;
    }
  });
  // "记住这次"复选框（登录态变化时增删）
  const form = $(p + "-form");
  let label = $(p + "-remember-label");
  if (isLoggedIn() && !label && form) {
    label = document.createElement("label");
    label.className = "remember-birth";
    label.id = p + "-remember-label";
    label.innerHTML = `<input type="checkbox" id="${p}-remember" checked /> 记住这次的出生信息，下次一键填入`;
    form.insertBefore(label, $(p + "-submit"));
  } else if (!isLoggedIn() && label) {
    label.remove();
  }
}

/* 登录/退出后刷新（app.js 的 setLoggedIn/setLoggedOut 会调用） */
window.__refreshBirthMemory = function () {
  birthProfileCache = null;
  initBirthMemory("bazi");
  initBirthMemory("ziwei");
  initBirthMemory("astro", { location: true });
};

function fillBirthForm(p, prof, hasLocation) {
  const setRadio = (name, val) => {
    document.querySelectorAll(`input[name="${p}-${name}"]`).forEach((r) => { r.checked = r.value === val; });
  };
  setRadio("gender", prof.gender === "female" ? "female" : "male");
  $(p + "-year").value = prof.birth_year || "";
  $(p + "-month").value = prof.birth_month || "";
  $(p + "-day").value = prof.birth_day || "";
  setRadio("cal", prof.calendar_type === "lunar" ? "lunar" : "solar");
  $(p + "-leap").checked = !!prof.is_leap_month;
  $(p + "-hour").value = String(prof.birth_hour);
  if (prof.birth_minute !== null && prof.birth_minute !== undefined) {
    $(p + "-minute").value = String(prof.birth_minute);
  }
  if (hasLocation && prof.latitude !== null && prof.latitude !== undefined &&
      prof.longitude !== null && prof.longitude !== undefined) {
    // 找坐标最近的城市（0.6 度内），找不到就走"手动填经纬度"
    let best = null, bestD = 0.6;
    PROVINCES.forEach((pr, pi) => pr[1].forEach((c, ci) => {
      const d = Math.abs(c[1] - prof.latitude) + Math.abs(c[2] - prof.longitude);
      if (d < bestD) { bestD = d; best = { pi, ci }; }
    }));
    const prov = $(p + "-province"), city = $(p + "-city"), llwrap = $(p + "-llwrap");
    prov.value = String(best ? best.pi : 0);
    prov.dispatchEvent(new Event("change"));
    if (best) {
      city.value = String(best.ci);
      city.dispatchEvent(new Event("change"));
    } else {
      city.value = "custom";
      city.dispatchEvent(new Event("change"));
      llwrap.hidden = false;
      $(p + "-lat").value = prof.latitude;
      $(p + "-lon").value = prof.longitude;
    }
  }
}

/* 排盘成功后：如果勾了"记住"，把这次的出生信息存下来（失败不打扰） */
async function maybeSaveBirthProfile(p, kind, body) {
  try {
    const box = $(p + "-remember");
    if (!box || !box.checked || !isLoggedIn()) return;
    const payload = Object.assign({ kind }, body);
    delete payload.userId; delete payload.question;
    await api("/api/profile/birth", { method: "POST", body: payload });
    birthProfileCache = null;
  } catch (e) { /* ignore */ }
}

/* ---------------- bazi ---------------- */
$("bazi-form-wrap").innerHTML = birthFormHTML("bazi");
initBirthMemory("bazi");
$("bazi-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  let body;
  try { body = readBirthForm("bazi"); } catch (err) { return; }
  const btn = $("bazi-submit");
  btn.disabled = true; btn.textContent = "排盘中…";
  try {
    const data = await api("/api/divination/bazi", { method: "POST", body });
    renderBaziResult(data);
    maybeSaveBirthProfile("bazi", "bazi", body);
    loadMiniHistory("bazi");
  } catch (err) {
    const el = $("bazi-error"); el.textContent = err.message; el.hidden = false;
  } finally {
    btn.disabled = false; btn.textContent = "🔮 排出命盘";
  }
});

let lastBazi = null;
function renderBaziResult(data) {
  lastBazi = data;
  const chart = data.chart || {};
  const info = chart["基本信息"] || {};
  const pillars = chart["四柱"] || [];
  const relations = chart["干支关系"] || [];
  $("bazi-pillars").innerHTML =
    `<div class="pillars-head">日主 <b>${esc(info["日主"] || "")}</b> · ${esc(info["性别"] || "")}</div>` +
    '<div class="pillars-grid">' + pillars.map((pl) => {
      const gz = String(pl["干支"] || "");
      const canggan = (pl["藏干"] || []).map((c) => `${esc(c["天干"])}(${esc(c["十神"])})`).join(" ");
      return `<div class="pillar">
        <div class="pillar-title">${esc(pl["柱"])}</div>
        <div class="pillar-gz"><span class="gan">${esc(gz[0] || "")}</span><span class="zhi">${esc(gz[1] || "")}</span></div>
        <div class="pillar-god">${esc(pl["天干十神"] || "")}</div>
        <div class="pillar-sub">藏干 ${esc(canggan) || "—"}</div>
        <div class="pillar-sub">${esc(pl["地势"] || "")}${pl["空亡"] === "是" ? ' · <span class="kong">空亡</span>' : ""}</div>
      </div>`;
    }).join("") + "</div>";
  $("bazi-relations").textContent = relations.length ? "干支关系：" + relations.join("；") : "";
  $("bazi-reading").innerHTML = para(data.reading);
  $("bazi-result").hidden = false;
  $("bazi-result").scrollIntoView({ behavior: "smooth" });
}
$("bazi-again").addEventListener("click", () => {
  $("bazi-result").hidden = true;
  $("bazi-form-wrap").scrollIntoView({ behavior: "smooth" });
});
$("bazi-journal").addEventListener("click", () => {
  if (!lastBazi) return;
  openJournalEditor({ mode: "new", link: { kind: "bazi", refId: lastBazi.id, label: `八字排盘 #${lastBazi.id}` } });
});

/* ---------------- ziwei ---------------- */
$("ziwei-form-wrap").innerHTML = birthFormHTML("ziwei");
initBirthMemory("ziwei");
$("ziwei-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  let body;
  try { body = readBirthForm("ziwei"); } catch (err) { return; }
  const btn = $("ziwei-submit");
  btn.disabled = true; btn.textContent = "排盘中…";
  try {
    const data = await api("/api/divination/ziwei", { method: "POST", body });
    renderZiweiResult(data);
    maybeSaveBirthProfile("ziwei", "ziwei", body);
    loadMiniHistory("ziwei");
  } catch (err) {
    const el = $("ziwei-error"); el.textContent = err.message; el.hidden = false;
  } finally {
    btn.disabled = false; btn.textContent = "🔮 排出命盘";
  }
});

let lastZiwei = null;
// 传统命盘按地支定位：4x4，外圈12格，中间2x2放基本信息
const ZW_LAYOUT = [
  ["巳", "午", "未", "申"],
  ["辰", null, null, "酉"],
  ["卯", null, null, "戌"],
  ["寅", "丑", "子", "亥"],
];
function renderZiweiResult(data) {
  lastZiwei = data;
  const chart = data.chart || {};
  const info = chart["基本信息"] || {};
  const palaces = chart["十二宫位"] || [];
  const byBranch = {};
  palaces.forEach((pl) => {
    const gz = String(pl["干支"] || "");
    const branch = gz[1];
    if (branch) byBranch[branch] = pl;
  });
  const cellHTML = (branch) => {
    if (!branch) return `<div class="zw-center">
      <div class="zw-center-title">紫微命盘</div>
      <div>命主 ${esc(info["命主"] || "")} · 身主 ${esc(info["身主"] || "")}</div>
      <div>${esc(info["五行局"] || "")}</div>
      <div class="hint-inline">${esc(info["四柱"] || "")}</div>
    </div>`;
    const pl = byBranch[branch];
    if (!pl) return `<div class="zw-cell empty"></div>`;
    const isSoul = pl["宫位"] === "命宫";
    const isBody = pl["是否身宫"] === "是";
    const majors = (pl["主星及四化"] || []).map((s) =>
      `<span class="zw-major">${esc(s["星名"])}${s["亮度"] ? `<i>${esc(s["亮度"])}</i>` : ""}</span>`).join("");
    const minors = (pl["辅星"] || []).map((s) => esc(s["星名"])).join(" ");
    return `<div class="zw-cell${isSoul ? " soul" : ""}${isBody ? " body" : ""}">
      <div class="zw-palace">${esc(pl["宫位"])}${isSoul ? " ★" : ""}${isBody && !isSoul ? " ◉" : ""}</div>
      <div class="zw-gz">${esc(pl["干支"])}</div>
      <div class="zw-stars">${majors || '<span class="hint-inline">无主星</span>'}</div>
      <div class="zw-minors">${esc(minors)}</div>
      <div class="zw-range">${esc(pl["大限"] || "")}</div>
    </div>`;
  };
  $("ziwei-grid").innerHTML = ZW_LAYOUT.map((row) =>
    `<div class="zw-row">${row.map(cellHTML).join("")}</div>`).join("");
  $("ziwei-reading").innerHTML = para(data.reading);
  $("ziwei-result").hidden = false;
  $("ziwei-result").scrollIntoView({ behavior: "smooth" });
}
$("ziwei-again").addEventListener("click", () => {
  $("ziwei-result").hidden = true;
  $("ziwei-form-wrap").scrollIntoView({ behavior: "smooth" });
});
$("ziwei-journal").addEventListener("click", () => {
  if (!lastZiwei) return;
  openJournalEditor({ mode: "new", link: { kind: "ziwei", refId: lastZiwei.id, label: `紫微斗数 #${lastZiwei.id}` } });
});

/* ---------------- astro ---------------- */
$("astro-form-wrap").innerHTML = birthFormHTML("astro", { location: true });
initBirthMemory("astro", { location: true });
wireLocationCascade("astro");
$("astro-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  let body;
  try { body = readBirthForm("astro", { location: true }); } catch (err) { return; }
  const btn = $("astro-submit");
  btn.disabled = true; btn.textContent = "排盘中…";
  try {
    const data = await api("/api/divination/astro", { method: "POST", body });
    renderAstroResult(data);
    maybeSaveBirthProfile("astro", "astro", body);
    loadMiniHistory("astro");
  } catch (err) {
    const el = $("astro-error"); el.textContent = err.message; el.hidden = false;
  } finally {
    btn.disabled = false; btn.textContent = "🔮 排出命盘";
  }
});

let lastAstro = null;
const PLANET_GLYPH = { sun: "☉", moon: "☽", mercury: "☿", venus: "♀", mars: "♂", jupiter: "♃", saturn: "♄", uranus: "♅", neptune: "♆", pluto: "♇" };
const SIGN_GLYPH = ["♈", "♉", "♊", "♋", "♌", "♍", "♎", "♏", "♐", "♑", "♒", "♓"];
const ASPECT_COLOR = { conjunction: "#e64980", opposition: "#e03131", square: "#f08c00", trine: "#1971c2", sextile: "#2f9e44" };

function renderAstroResult(data) {
  lastAstro = data;
  drawWheel($("astro-wheel"), data.extra);
  const bodies = (data.extra && data.extra.bodies) || [];
  $("astro-points").innerHTML = bodies.map((b) =>
    `<div class="astro-point"><span class="ap-glyph">${PLANET_GLYPH[b.key] || "✦"}</span>
     <span class="ap-name">${esc(b.label)}</span>
     <span class="hint-inline">${esc(b.sign)} ${esc(b.degInSign)} · ${b.house ? "第" + b.house + "宫" : ""}</span></div>`
  ).join("");
  $("astro-reading").innerHTML = para(data.reading);
  $("astro-result").hidden = false;
  $("astro-result").scrollIntoView({ behavior: "smooth" });
}

function drawWheel(svg, extra) {
  const NS = "http://www.w3.org/2000/svg";
  svg.innerHTML = "";
  if (!extra || extra.ascLon === null) {
    svg.innerHTML = '<text x="200" y="200" text-anchor="middle" fill="#8b8fa3">星盘数据缺失</text>';
    return;
  }
  const asc = extra.ascLon;
  const C = 200;
  const P = (lon, r) => {
    const rad = (180 - (lon - asc)) * Math.PI / 180;
    return [C + r * Math.cos(rad), C - r * Math.sin(rad)];
  };
  const mk = (tag, attrs, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    (parent || svg).appendChild(n);
    return n;
  };
  const line = (lon1, r1, lon2, r2, attrs) => {
    const [x1, y1] = P(lon1, r1), [x2, y2] = P(lon2, r2);
    return mk("line", Object.assign({ x1, y1, x2, y2 }, attrs));
  };
  // rings
  [190, 155, 105].forEach((r) => mk("circle", { cx: C, cy: C, r, fill: "none", stroke: "#3a3f5c", "stroke-width": r === 190 ? 2 : 1 }));
  // sign divisions + glyphs
  for (let i = 0; i < 12; i++) {
    line(i * 30, 190, i * 30, 155, { stroke: "#3a3f5c", "stroke-width": 1 });
    const [gx, gy] = P(i * 30 + 15, 172);
    const t = mk("text", { x: gx, y: gy, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 14, fill: "#aab" });
    t.textContent = SIGN_GLYPH[i];
  }
  // house cusps
  (extra.houses || []).forEach((h) => {
    const isAsc = Math.abs(((h.startLon - asc) % 360 + 360) % 360) < 0.5;
    line(h.startLon, 155, h.startLon, 105, { stroke: isAsc ? "#ffd97a" : "#4a5170", "stroke-width": isAsc ? 2.5 : 1 });
    const mid = h.startLon + 15;
    const [nx, ny] = P(mid, 128);
    const t = mk("text", { x: nx, y: ny, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 10, fill: "#777d99" });
    t.textContent = h.id;
  });
  // ASC marker
  {
    const [ax, ay] = P(asc, 190);
    const t = mk("text", { x: ax - 2, y: ay, "text-anchor": "end", "dominant-baseline": "central", "font-size": 11, fill: "#ffd97a", "font-weight": "bold" });
    t.textContent = "ASC";
  }
  // planets (decluttered display longitudes, lines to true positions)
  const bodies = (extra.bodies || []).slice().sort((a, b) => a.lon - b.lon);
  const disp = [];
  bodies.forEach((b, i) => {
    let l = b.lon;
    if (i > 0) l = Math.max(l, disp[i - 1] + 9);
    disp.push(l);
  });
  for (let i = bodies.length - 2; i >= 0; i--) {
    if (disp[i + 1] - disp[i] < 9) disp[i] = disp[i + 1] - 9;
  }
  const lonByKey = {};
  bodies.forEach((b, i) => {
    lonByKey[b.key] = b.lon;
    const [px, py] = P(disp[i], 132);
    const t = mk("text", { x: px, y: py, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 16, fill: "#e8e4f5" });
    t.textContent = PLANET_GLYPH[b.key] || "✦";
    const tip = mk("title", {}, t);
    tip.textContent = `${b.label} ${b.sign}${b.degInSign}`;
    // tick from glyph ring to true position
    line(disp[i], 126, b.lon, 112, { stroke: "#4a5170", "stroke-width": 1 });
  });
  // aspects
  const seen = new Set();
  (extra.aspects || []).forEach((a) => {
    if (lonByKey[a.from] === undefined || lonByKey[a.to] === undefined) return;
    const k = [a.from, a.to].sort().join("|");
    if (seen.has(k)) return;
    seen.add(k);
    const color = ASPECT_COLOR[a.type] || "#888";
    const [x1, y1] = P(lonByKey[a.from], 100);
    const [x2, y2] = P(lonByKey[a.to], 100);
    mk("line", { x1, y1, x2, y2, stroke: color, "stroke-width": 1.4, opacity: Math.max(0.35, 1 - (a.orb || 0) / 8) });
  });
}
$("astro-again").addEventListener("click", () => {
  $("astro-result").hidden = true;
  $("astro-form-wrap").scrollIntoView({ behavior: "smooth" });
});
$("astro-journal").addEventListener("click", () => {
  if (!lastAstro) return;
  openJournalEditor({ mode: "new", link: { kind: "astro", refId: lastAstro.id, label: `西方星盘 #${lastAstro.id}` } });
});

/* ---------------- mini history (per kind) ---------------- */
async function loadMiniHistory(kind) {
  const box = $(kind + "-history");
  if (!box) return;
  try {
    const data = await api(`/api/divination/history?kind=${kind}&userId=${encodeURIComponent(uid())}`);
    const items = data.items || [];
    box.innerHTML = items.length ? items.map((it) =>
      `<button class="mini-item" data-id="${it.id}">
        <span class="mini-date">${esc((it.created_at || "").slice(0, 10))}</span>
        <span class="mini-q">${esc(it.question || "（未留问题）")}</span>
      </button>`).join("")
      : `<p class="hint">还没有${VIEW_TITLES[kind]}记录，排一张试试吧 ✨</p>`;
    box.querySelectorAll(".mini-item").forEach((b) =>
      b.addEventListener("click", () => openDivinationDetail(kind, b.dataset.id)));
  } catch (e) {
    box.innerHTML = `<p class="hint">加载失败，请重试。</p>`;
  }
}
async function openDivinationDetail(kind, id) {
  try {
    const d = await api(`/api/divination/${kind}/${id}?userId=${encodeURIComponent(uid())}`);
    switchView(kind);
    if (kind === "bazi") renderBaziResult(d);
    else if (kind === "ziwei") renderZiweiResult(d);
    else renderAstroResult(d);
  } catch (e) { alert(e.message); }
}

/* ---------------- journal ---------------- */
const MOODS = [["开心", "😊"], ["平静", "😌"], ["迷茫", "😕"], ["难过", "😢"], ["期待", "🤩"], ["感恩", "🙏"]];
const KIND_LABEL = { note: "随笔", tarot: "塔罗", bazi: "八字", ziwei: "紫微", astro: "星盘" };
let journalState = { mode: "new", id: null, link: null, mood: "" };

$("journal-new").addEventListener("click", () => openJournalEditor({ mode: "new" }));

async function loadJournal() {
  const box = $("journal-list");
  box.innerHTML = `<p class="hint">加载中…</p>`;
  try {
    const data = await api(`/api/journal?userId=${encodeURIComponent(uid())}`);
    const items = data.items || [];
    box.innerHTML = items.length ? items.map((it) =>
      `<button class="journal-card" data-id="${it.id}">
        <div class="jc-top"><span class="jc-kind">${KIND_LABEL[it.kind] || "随笔"}</span>
        ${it.mood ? `<span class="jc-mood">${esc(it.mood)}</span>` : ""}
        <span class="jc-date">${esc((it.created_at || "").slice(0, 10))}</span></div>
        ${it.title ? `<div class="jc-title">${esc(it.title)}</div>` : ""}
        <div class="jc-excerpt">${esc(it.excerpt || "")}${(it.excerpt || "").length >= 120 ? "…" : ""}</div>
      </button>`).join("")
      : `<div class="journal-empty"><p>📓 还没有日记</p><p class="hint">占卜之后点"记到日记"，或直接写一篇，记录此刻的心情。</p></div>`;
    box.querySelectorAll(".journal-card").forEach((c) =>
      c.addEventListener("click", () => openJournalEntry(c.dataset.id)));
  } catch (e) {
    box.innerHTML = `<p class="hint">加载失败，请重试。</p>`;
  }
}

function renderMoods(selected) {
  $("journal-moods").innerHTML = MOODS.map(([m, e]) =>
    `<button type="button" class="mood${m === selected ? " sel" : ""}" data-mood="${m}">${e} ${m}</button>`).join("");
  $("journal-moods").querySelectorAll(".mood").forEach((b) =>
    b.addEventListener("click", () => {
      journalState.mood = journalState.mood === b.dataset.mood ? "" : b.dataset.mood;
      renderMoods(journalState.mood);
    }));
}

function openJournalEditor(opts) {
  opts = opts || {};
  journalState = { mode: opts.mode || "new", id: opts.id || null, link: opts.link || null, mood: opts.mood || "" };
  $("journal-modal-title").textContent = journalState.mode === "new" ? "✏️ 写日记" : "📓 日记";
  const li = $("journal-link-info");
  if (journalState.link) {
    li.hidden = false;
    li.textContent = `关联解读：${journalState.link.label}（保存后自动关联）`;
  } else li.hidden = true;
  $("journal-title").value = opts.title || "";
  $("journal-content").value = opts.content || "";
  $("journal-content").hidden = false;
  $("journal-readonly").hidden = true;
  $("journal-error").hidden = true;
  renderMoods(journalState.mood);
  setJournalMode(journalState.mode === "new" ? "edit" : "view");
  $("journal-modal").hidden = false;
}

function setJournalMode(m) {
  const editing = m === "edit";
  $("journal-title").disabled = !editing;
  $("journal-content").hidden = !editing;
  $("journal-readonly").hidden = editing;
  $("journal-moods").style.display = editing ? "" : "none";
  $("journal-save").hidden = !editing;
  $("journal-edit").hidden = editing;
  $("journal-delete").hidden = editing || !journalState.id;
}

async function openJournalEntry(id) {
  try {
    const e = await api(`/api/journal/${id}?userId=${encodeURIComponent(uid())}`);
    journalState = { mode: "view", id: e.id, link: null, mood: e.mood || "", raw: e.content || "" };
    $("journal-modal-title").textContent = "📓 日记";
    $("journal-link-info").hidden = true;
    $("journal-title").value = e.title || "";
    $("journal-readonly").innerHTML =
      `<div class="jc-top"><span class="jc-kind">${KIND_LABEL[e.kind] || "随笔"}</span>
       ${e.mood ? `<span class="jc-mood">${esc(e.mood)}</span>` : ""}
       <span class="jc-date">${esc((e.created_at || "").slice(0, 16).replace("T", " "))}</span></div>` +
      para(e.content);
    renderMoods(e.mood || "");
    setJournalMode("view");
    $("journal-modal").hidden = false;
  } catch (err) { alert(err.message); }
}

$("journal-close").addEventListener("click", () => { $("journal-modal").hidden = true; });
$("journal-modal").addEventListener("click", (e) => {
  if (e.target === $("journal-modal")) $("journal-modal").hidden = true;
});
$("journal-edit").addEventListener("click", () => {
  $("journal-content").value = journalState.raw || "";
  journalState.mode = "edit";
  setJournalMode("edit");
});
$("journal-save").addEventListener("click", async () => {
  const content = $("journal-content").value.trim();
  const errBox = $("journal-error");
  if (!content) { errBox.textContent = "日记内容不能为空。"; errBox.hidden = false; return; }
  errBox.hidden = true;
  const btn = $("journal-save");
  btn.disabled = true;
  try {
    const payload = {
      userId: uid(),
      title: $("journal-title").value.trim(),
      content,
      mood: journalState.mood,
      kind: (journalState.link && journalState.link.kind) || "note",
      refId: (journalState.link && journalState.link.refId) || null,
    };
    if (journalState.mode === "edit" && journalState.id) {
      await api(`/api/journal/${journalState.id}`, { method: "PUT", body: payload });
    } else {
      await api("/api/journal", { method: "POST", body: payload });
    }
    $("journal-modal").hidden = true;
    if (!$("view-journal").hidden) loadJournal();
  } catch (err) {
    errBox.textContent = err.message; errBox.hidden = false;
  } finally {
    btn.disabled = false;
  }
});
$("journal-delete").addEventListener("click", async () => {
  if (!journalState.id || !confirm("确定删除这篇日记吗？")) return;
  try {
    await api(`/api/journal/${journalState.id}?userId=${encodeURIComponent(uid())}`, { method: "DELETE" });
    $("journal-modal").hidden = true;
    loadJournal();
  } catch (err) { alert(err.message); }
});

/* "记到日记" from a tarot reading: app.js shows #share-reading when a
   reading completes — mirror its visibility, no app.js changes needed. */
new MutationObserver(() => {
  $("journal-from-tarot").hidden = $("share-reading").hidden;
}).observe($("share-reading"), { attributes: true, attributeFilter: ["hidden"] });
$("journal-from-tarot").addEventListener("click", () => {
  const q = ($("question") && $("question").value.trim()) || "";
  openJournalEditor({
    mode: "new",
    link: { kind: "tarot", refId: null, label: "塔罗占卜" },
    content: q ? `问题：${q}\n\n` : "",
  });
});

})();
