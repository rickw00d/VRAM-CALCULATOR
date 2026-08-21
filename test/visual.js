/* 版面 / 互動迴歸測試(真實瀏覽器)
 *
 * 為什麼需要這支:ctx-test.js 跑在 jsdom 上,不做版面計算也不套用 CSS,
 * 因此「元素存在且屬性正確」全過、但畫面上根本不會顯示的 bug 它抓不到。
 * 實際踩過一次:tooltip 用了 .tipbtn:hover + .tip(緊鄰手足)而 DOM 上兩者
 * 中間隔著 #fragv,選擇器永遠不命中、面板從頭到尾是死的,60 項 jsdom 測試卻全過。
 *
 * 這裡驗的是 jsdom 驗不到的那一半:hover/focus 真的會顯示、面板不溢出視窗、
 * 不遮住底下該點的東西、收起後不留隱形遮罩。
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

let chromium;
try { ({ chromium } = require("playwright-core")); }
catch { console.error("缺少 playwright-core,請先執行:npm install"); process.exit(1); }

const ROOT = path.join(__dirname, "..");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };

let pass = 0, fail = 0;
const t = (name, ok, detail) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "OK  " : "FAIL"} ${name}${!ok && detail !== undefined ? "  → " + detail : ""}`);
};

/* 自帶靜態伺服器:用系統分配的臨時埠,不必另裝 http-server,
   也不會和開發時開在 8123 的那個撞埠。 */
function serve() {
  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html";
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => srv.listen(0, "127.0.0.1", () => r([srv, `http://127.0.0.1:${srv.address().port}`])));
}

/* 優先借用系統已安裝的 Edge / Chrome,避免為了跑測試去下載一整包 Chromium。
   都沒有才退回 playwright 自帶的(需先 npx playwright install chromium)。 */
async function launch() {
  const args = ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"];
  for (const channel of ["msedge", "chrome", undefined]) {
    try { return [await chromium.launch({ channel, headless: true, args }), channel || "bundled"]; }
    catch { /* 換下一個 */ }
  }
  console.error("找不到可用的瀏覽器。請安裝 Edge 或 Chrome,或執行:npx playwright install chromium");
  process.exit(1);
}

/* 每個 tooltip 一筆。新增說明面板時在這裡補一行即可。
   up      = 是否向上開(錨點在容器底部時必須向上,否則面板會掉出卡片外)
   keeps   = 面板開啟時仍必須點得到的元素 id */
const TIPS = [
  { id: "fragTip", name: "碎片化餘裕說明", keeps: [] },
  { id: "actTip",  name: "匯出/匯入說明", keeps: ["copyCsv", "copyCfg", "loadCfg"] },
];

const btnOf = (page, tipId) =>
  page.locator(`#${tipId}`).locator("xpath=preceding-sibling::button[@class='tipbtn']");

async function checkTip(page, tip, vw, vh) {
  const btn = btnOf(page, tip.id);
  const disp = () => page.evaluate(id => getComputedStyle(document.getElementById(id)).display, tip.id);

  await page.mouse.move(0, 0);
  await page.waitForTimeout(120);
  t(`${tip.name}:預設收起`, (await disp()) === "none");

  await btn.scrollIntoViewIfNeeded();
  await btn.hover();
  await page.waitForTimeout(220);
  const shown = (await disp()) !== "none";
  // 最關鍵的一項 —— 選擇器寫錯時面板永遠不出現,而 jsdom 測不出來
  t(`${tip.name}:hover 後顯示`, shown);
  if (!shown) return;

  const box = await page.locator(`#${tip.id}`).boundingBox();
  t(`${tip.name}:不超出視窗左右`, box.x >= 0 && box.x + box.width <= vw,
    `x=${box.x.toFixed(0)} w=${box.width.toFixed(0)} vw=${vw}`);
  t(`${tip.name}:完整落在可視範圍內`, box.y >= 0 && box.y + box.height <= vh,
    `y=${box.y.toFixed(0)} h=${box.height.toFixed(0)} vh=${vh}`);

  // 方向是動態的(依剩餘空間翻轉),所以不驗固定方向,只驗「不論按鈕捲到哪都讀得完整」

  for (const id of tip.keeps) {
    const ok = await page.evaluate(bid => {
      const b = document.getElementById(bid), r = b.getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return el === b || b.contains(el);
    }, id);
    t(`${tip.name}:開啟時 #${id} 仍可點`, ok);
  }

  /* 只驗「收起後不留隱形遮罩」。不驗「開啟時底下元素可點」——
     游標一離開按鈕面板就消失,同時 hover 按鈕又操作底下元素在真實使用中不存在,
     那樣斷言只會製造假失敗(寫這支測試時踩過)。 */
  await page.mouse.move(5, 5);
  await page.waitForTimeout(220);
  t(`${tip.name}:移開游標後收起`, (await disp()) === "none");
}

/* 把按鈕捲到視窗高度的指定比例處,用來逼出「下方空間不足」的情境。
   這是原本會漏掉的 bug:面板往下開超出畫面,而捲動就會離開按鈕、面板關閉,
   超出的那截永遠讀不到。 */
async function scrollBtnTo(page, tipId, frac) {
  await page.evaluate(([id, f]) => {
    const tipEl = document.getElementById(id);
    let b = tipEl.previousElementSibling;
    while (b && !b.classList.contains("tipbtn")) b = b.previousElementSibling;
    const abs = b.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, Math.max(0, abs - window.innerHeight * f));
  }, [tipId, frac]);
  await page.waitForTimeout(150);
}

async function checkAutoFlip(page, tip, vw, vh) {
  for (const [label, frac] of [["按鈕靠近底部", 0.85], ["按鈕靠近頂部", 0.12], ["按鈕置中", 0.5]]) {
    await page.mouse.move(0, 0);
    await scrollBtnTo(page, tip.id, frac);
    const btn = btnOf(page, tip.id);
    await btn.hover();
    await page.waitForTimeout(200);
    const box = await page.locator(`#${tip.id}`).boundingBox();
    if (!box) { t(`${tip.name}:${label}時仍顯示`, false); continue; }
    const ok = box.y >= 0 && box.y + box.height <= vh;
    t(`${tip.name}:${label}時面板完整可見`, ok,
      `y=${box.y.toFixed(0)} 底=${(box.y + box.height).toFixed(0)} vh=${vh}`);
  }
}

async function checkKeyboard(page, tip) {
  await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
  let n = 0, hit = false;
  while (n < 80 && !hit) {
    await page.keyboard.press("Tab"); n++;
    hit = await page.evaluate(id => {
      const tipEl = document.getElementById(id);
      let b = tipEl.previousElementSibling;
      while (b && !b.classList.contains("tipbtn")) b = b.previousElementSibling;
      return document.activeElement === b;
    }, tip.id);
  }
  if (!hit) { t(`${tip.name}:鍵盤可巡覽到說明按鈕`, false, `按了 ${n} 次 Tab 仍未抵達`); return; }
  await page.waitForTimeout(150);
  const d = await page.evaluate(id => getComputedStyle(document.getElementById(id)).display, tip.id);
  // 用真實 Tab 而非程式化 .focus():焦點可見性取決於最後一次輸入方式,
  // 滑鼠操作後再呼叫 .focus() 不會觸發 :focus-visible,會得到假失敗。
  t(`${tip.name}:鍵盤 Tab 聚焦後顯示`, d !== "none", `display=${d}`);
}

(async () => {
  const [srv, base] = await serve();
  const [browser, channel] = await launch();
  console.log(`瀏覽器:${channel}   位址:${base}\n`);
  const errors = [];

  for (const [theme, vw, vh] of [["light", 1280, 950], ["dark", 1280, 950], ["light", 375, 812]]) {
    console.log(`== ${theme} ${vw}×${vh} ==`);
    const page = await browser.newPage({ viewport: { width: vw, height: vh }, colorScheme: theme });
    page.on("pageerror", e => errors.push(`[${theme} ${vw}] ${e.message}`));
    page.on("console", m => { if (m.type() === "error") errors.push(`[${theme} ${vw}] ${m.text()}`); });
    // 外部字型與版面驗證無關,擋掉以免受網路狀況影響
    await page.route("**/fonts.googleapis.com/**", r => r.abort());
    await page.route("**/fonts.gstatic.com/**", r => r.abort());
    await page.goto(`${base}/index.html`, { waitUntil: "load", timeout: 20000 });

    for (const tip of TIPS) await checkTip(page, tip, vw, vh);
    for (const tip of TIPS) await checkAutoFlip(page, tip, vw, vh);
    if (vw >= 1280) for (const tip of TIPS) await checkKeyboard(page, tip);

    t("頁面本體不橫向捲動",
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      await page.evaluate(() => `${document.documentElement.scrollWidth} > ${window.innerWidth}`));
    await page.close();
    console.log("");
  }

  console.log("== 執行期無錯誤 ==");
  // 擋掉的字型請求會產生 ERR_FAILED,屬預期,不計入
  const real = errors.filter(e => !/ERR_FAILED|Failed to load resource/.test(e));
  t("無 JS / console 錯誤", real.length === 0, real.join(" | "));

  await browser.close();
  srv.close();
  console.log(`\n結果: ${pass} 通過 / ${fail} 失敗`);
  process.exit(fail ? 1 : 0);
})();
