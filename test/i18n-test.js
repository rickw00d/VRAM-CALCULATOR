// i18n 基礎建設迴歸測試。見 TESTING.md §8
// 執行:node test/i18n-test.js
const fs = require("fs"), path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

function load(url) {
  const errs = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", e => errs.push("jsdomError: " + e.message));
  vc.on("error", (...a) => errs.push("console.error: " + a.join(" ")));
  const dom = new JSDOM(html, {
    runScripts: "dangerously", virtualConsole: vc, pretendToBeVisual: true, url,
    beforeParse(win) {
      win.matchMedia = q => ({ media: q, matches: false, onchange: null,
        addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){}, dispatchEvent(){} });
    },
  });
  return { w: dom.window, d: dom.window.document, errs };
}

let pass = 0, fail = 0;
const t = (n, c, x = "") => { c ? (pass++, console.log("  OK   " + n))
  : (fail++, console.log("  FAIL " + n + (x ? "  → " + x : ""))); };

console.log("\n== 1. doctype 與 lang 屬性 ==");
{
  const { d } = load("http://localhost/?lang=zh-TW");
  t("已脫離 quirks mode", d.compatMode === "CSS1Compat", d.compatMode);
  t("html lang = zh-TW", d.documentElement.lang === "zh-TW", d.documentElement.lang);
  t("CJK 字型為 Noto Sans TC",
    d.documentElement.style.getPropertyValue("--cjk-font").includes("TC"),
    d.documentElement.style.getPropertyValue("--cjk-font"));
}

console.log("\n== 2. ?lang=en 切換為英文 ==");
let enDom;
{
  const { w, d, errs } = load("http://localhost/?lang=en");
  enDom = { w, d };
  t("無執行期錯誤", errs.length === 0, errs.join(" | "));
  t("html lang = en", d.documentElement.lang === "en", d.documentElement.lang);
  t("document.title 為英文", d.title === "VRAM Calculator", d.title);
  t("h1 為英文", /LLM Inference VRAM Calculator/.test(d.querySelector("h1").textContent),
    d.querySelector("h1").textContent);
  t("表頭「加速卡」→ Accelerator",
    d.querySelector(".gpu thead th").textContent === "Accelerator",
    d.querySelector(".gpu thead th").textContent);
  t("主題按鈕文字為英文", ["Light", "Dark"].includes(d.getElementById("themeTxt").textContent),
    d.getElementById("themeTxt").textContent);
  t("分解表首列為 Model weights",
    d.querySelector("#bd tr td").textContent.includes("Model weights"),
    d.querySelector("#bd tr td").textContent);
  t("上下文選單「自訂…」→ Custom…",
    [...d.getElementById("ctx").options].some(o => o.textContent === "Custom…"));
  t("CJK 字型改為非 TC(英文不需要 TC 字形)",
    !d.documentElement.style.getPropertyValue("--cjk-font").includes("TC"),
    d.documentElement.style.getPropertyValue("--cjk-font"));
}

console.log("\n== 3. 缺 key 的回退行為(合成測試)==");
{
  const { w, d } = enDom;
  // 不依賴「剛好有沒翻完的 key」:直接註冊一個只存在於 zh-TW 的 key 來驗證回退鏈。
  w.eval(`DICT["zh-TW"]["__probe"] = "回退成功";`);
  t("缺 key 時回退到 zh-TW", w.eval(`T("__probe")`) === "回退成功", w.eval(`T("__probe")`));
  t("兩本字典都沒有時,TD() 用呼叫端原文",
    w.eval(`TD("__nope", "原文保留")`) === "原文保留", w.eval(`TD("__nope","原文保留")`));
  t("兩本字典都沒有時,Tmaybe() 回 undefined",
    w.eval(`Tmaybe("__nope") === undefined`));

  // 缺 key 不得清空 DOM(P1 踩過:頁尾整段被覆蓋成裸字串 "foot")
  const footEl = d.querySelector("footer");
  const before = footEl.innerHTML;
  footEl.setAttribute("data-i18n-html", "__definitely_missing");
  w.eval("applyI18n()");
  t("缺 key 時保留原內容而非清空", footEl.innerHTML === before,
    `${before.length} → ${footEl.innerHTML.length}`);
  footEl.setAttribute("data-i18n-html", "foot");
  w.eval("applyI18n()");

  const foot = footEl.textContent;
  t("頁尾已完成英譯(P2)", /The model/.test(foot) && !/[一-龥]/.test(foot),
    foot.slice(0, 50));
  const badge = d.getElementById("attnBadge").textContent;
  t("模型架構描述已英譯", badge.length > 0 && !/[一-龥]/.test(badge), badge);

  // 探針用完必須清掉,否則它會被 §4 的覆蓋率當成「en 漏譯的 key」
  w.eval(`delete DICT["zh-TW"]["__probe"];`);
  // 只看「畫面上看得到的文字」:body.textContent 會把 <script> 原始碼也算進去,
  // 掃到的會是字典自己的 key 而非渲染結果。
  const visible = [...d.body.querySelectorAll("*")]
    .filter(el => !["SCRIPT", "STYLE"].includes(el.tagName))
    .map(el => [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(""))
    .join(" ");
  const bare = visible.match(/\b(head|in|res|bd|gpu|note|rec|msg|csv|warn|tip|arch|scn|act|foot|ctx|theme|mem)\.[a-zA-Z]+\b/g);
  t("畫面上不出現裸 key(如 head.title)", !bare, bare && bare.join(","));
}

console.log("\n== 4. 翻譯覆蓋率報告 ==");
{
  const { w } = enDom;
  const cov = w.eval("JSON.stringify(i18nCoverage('en'))");
  const c = JSON.parse(cov);
  console.log(`   en: ${c.translated}/${c.total} 已翻譯,缺 ${c.missing.length} 項`);
  console.log(`   缺漏:${c.missing.join(", ") || "(無)"}`);
  t("i18nCoverage() 可用", c.total > 50, String(c.total));
  // P1 的邊界:UI 骨架(標籤、按鈕、表頭、動態訊息、選單選項)必須全譯;
  // 長篇論述(tip./foot/arch.foot)與模型架構描述(m.*)留給 P2。
  t("UI 骨架已全數翻譯(缺漏僅限長篇論述與模型描述)",
    c.missing.every(k => /^(tip\.|foot$|arch\.foot$|m\.)/.test(k)),
    c.missing.filter(k => !/^(tip\.|foot$|arch\.foot$|m\.)/.test(k)).join(","));
}

console.log("\n== 4.5 英文版畫面上不得殘留中文 ==");
{
  // 覆蓋率 100% 只證明 key 存在,不證明畫面乾淨:
  // 漏標 data-i18n、或譯文裡夾雜中文標點,覆蓋率都照樣滿分。
  const { d } = enDom;
  const cjk = /[一-龥]/;
  const offenders = [];
  // 語言選擇器豁免:語言名稱本就該用該語言自己的寫法(endonym),
  // 德文使用者要在選單裡看到 "Deutsch" 而不是 "German"。
  const walk = el => {
    if (["SCRIPT", "STYLE"].includes(el.tagName) || el.id === "lang") return;
    [...el.childNodes].forEach(n => {
      if (n.nodeType === 3 && cjk.test(n.textContent))
        offenders.push(`<${el.tagName.toLowerCase()}> "${n.textContent.trim().slice(0, 45)}"`);
      else if (n.nodeType === 1) walk(n);
    });
  };
  walk(d.body);
  t("無中文文字節點殘留", offenders.length === 0, offenders.slice(0, 5).join(" ／ "));

  // 屬性也要檢查:title / aria-label / placeholder 漏譯不會出現在文字節點裡
  const attrBad = [];
  d.querySelectorAll("*").forEach(el => {
    ["title", "aria-label", "placeholder"].forEach(a => {
      const v = el.getAttribute(a);
      if (v && cjk.test(v)) attrBad.push(`${el.tagName.toLowerCase()}[${a}]="${v.slice(0, 40)}"`);
    });
  });
  t("無中文屬性殘留(title / aria-label / placeholder)",
    attrBad.length === 0, attrBad.slice(0, 5).join(" ／ "));

  // 選單選項的 text 不在文字節點掃描範圍內,單獨檢查
  const optBad = [...d.querySelectorAll("option, optgroup")]
    .filter(o => o.closest("#lang") === null)      // 同上,語言選單豁免
    .map(o => o.label || o.textContent)
    .filter(s => cjk.test(s));
  t("選單選項與分組無中文殘留", optBad.length === 0, optBad.slice(0, 5).join(" ／ "));
}

console.log("\n== 5. 執行期切換語系保留狀態 ==");
{
  const { w, d } = load("http://localhost/?lang=zh-TW");
  const sel = d.getElementById("model"), ctx = d.getElementById("ctx");
  // 先設定一個非預設狀態
  d.querySelector('.scn[data-scn="agent"]').click();
  const beforeModel = sel.value, beforeCtx = ctx.value;
  const beforeTotal = d.getElementById("totalGB").textContent;
  const beforeW = w.eval('lastSnapshot.rows.find(r=>r[0]==="模型權重")[1]');
  // 切英文
  const lang = d.getElementById("lang");
  lang.value = "en";
  lang.dispatchEvent(new w.Event("change", { bubbles: true }));
  t("模型選取保留", sel.value === beforeModel, `${beforeModel} → ${sel.value}`);
  t("上下文選取保留", ctx.value === beforeCtx, `${beforeCtx} → ${ctx.value}`);
  t("合計數值不變", d.getElementById("totalGB").textContent === beforeTotal,
    `${beforeTotal} → ${d.getElementById("totalGB").textContent}`);
  const afterW = w.eval('lastSnapshot.rows.find(r=>r[0]==="Model weights")[1]');
  t("權重數值不變(僅標籤改變)", Math.abs(afterW - beforeW) < 1e-9, `${beforeW} vs ${afterW}`);
  t("UI 已變英文", d.querySelector("h1").textContent.includes("Inference"));
  t("agent 範本仍為 pressed(切語系不該清掉)",
    d.querySelector('.scn[data-scn="agent"]').getAttribute("aria-pressed") === "true");
  t("localStorage 已記住語系", w.localStorage.getItem("vram.lang") === "en",
    w.localStorage.getItem("vram.lang"));
  // 切回繁中
  lang.value = "zh-TW";
  lang.dispatchEvent(new w.Event("change", { bubbles: true }));
  t("切回繁中無誤", d.querySelector("h1").textContent.includes("估算器"));
  t("來回切換後合計仍相同", d.getElementById("totalGB").textContent === beforeTotal);
}

console.log("\n== 6. 語系決定優先序 ==");
{
  const { w } = load("http://localhost/?lang=en");
  t("?lang= 優先於瀏覽器語言", w.eval("LOCALE") === "en", w.eval("LOCALE"));
  const { w: w2 } = load("http://localhost/?lang=xx-YY");
  t("無效語系碼回退(不炸)", ["zh-TW", "en"].includes(w2.eval("LOCALE")), w2.eval("LOCALE"));
}

console.log(`\n結果: ${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
