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

console.log("\n== 3. 未翻譯者回退繁中(而非空白或裸 key)==");
{
  const { d } = enDom;
  const foot = d.querySelector("footer").textContent;
  t("頁尾回退為繁中(P2 待譯)", /計算模型/.test(foot), foot.slice(0, 40));
  t("回退內容非空", foot.trim().length > 200, String(foot.trim().length));
  const badge = d.getElementById("attnBadge").textContent;
  t("模型架構描述回退繁中", badge.length > 0 && !badge.includes("m."), badge);
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
