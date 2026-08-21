// 上下文長度下拉選單(CTX_OPTIONS / SCN)迴歸測試。見 TESTING.md §7.5
// 執行:npm install jsdom --no-save && node test/ctx-test.js
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

const errors = [];
const vc = new (require("jsdom").VirtualConsole)();
vc.on("jsdomError", e => errors.push("jsdomError: " + e.message));
vc.on("error", (...a) => errors.push("console.error: " + a.join(" ")));

const dom = new JSDOM(html, { runScripts: "dangerously", virtualConsole: vc,
  pretendToBeVisual: true, url: "http://localhost/",
  // jsdom 未實作 matchMedia,補一個 stub(真實瀏覽器有,非頁面缺陷)
  beforeParse(win){
    win.matchMedia = q => ({
      media: q, matches: false, onchange: null,
      addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){}, dispatchEvent(){},
    });
  },
});
const w = dom.window, d = w.document;
const $ = id => d.getElementById(id);
// 頁面用 const/let 宣告的 top-level 綁定不會掛到 window,必須經由頁面自身的 eval 取用
const ev = expr => w.eval(expr);

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  OK   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? "  → " + extra : "")); }
};
const ctxVal = () => ev("getCtx()");
const snapRow = name => ev(`lastSnapshot.rows.find(r => r[0] === ${JSON.stringify(name)})[1]`);
const pressed = () => [...d.querySelectorAll('.scn[aria-pressed="true"]')].map(e => e.dataset.scn);
const clickScn = k => d.querySelector(`.scn[data-scn="${k}"]`).click();
const fire = (el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true }));

console.log("\n== 1. 啟動與斷言 ==");
t("無 jsdom / console.error", errors.length === 0, errors.join(" | "));

console.log("\n== 2. 選單結構 ==");
const sel = $("ctx");
const groups = [...sel.querySelectorAll("optgroup")].map(g => g.label);
t("select 取代 number input", sel.tagName === "SELECT");
t("5 個 optgroup", groups.length === 5, groups.join(","));
t("分組順序正確",
  groups.join("|") === "對話 / 助理|檢索 / 知識問答|Agent / 工具呼叫|長文件處理|程式開發", groups.join("|"));
// 從 CTX_OPTIONS 推導而非寫死數字,新增選項時不必改測試
const optCount = ev("CTX_OPTIONS.length");
t(`${optCount} 選項 + 自訂 = ${optCount + 1}`, sel.options.length === optCount + 1,
  "實得 " + sel.options.length);
t("最後一項是自訂", sel.options[sel.options.length - 1].value === "custom");
t("無影片/生圖選項(方案 A)",
  !/影片|生圖|1080p|LTX|MiniMax|Hunyuan|LongCat/.test(sel.textContent), sel.textContent);
t("Agent 組含 OpenClaw 與 Hermes",
  /OpenClaw/.test(sel.textContent) && /Hermes/.test(sel.textContent));

console.log("\n== 3. 預設值 ==");
t("預設 ctx = 8192", ctxVal() === 8192, String(ctxVal()));
t("預設選中 chat-8k", sel.value === "chat-8k", sel.value);
t("自訂輸入框預設隱藏", $("ctxCustom").hidden === true);

console.log("\n== 4. 重複數值的分組不互搶 ==");
const dup = ev("CTX_OPTIONS.filter(o => o.v === 131072).map(o => o.id)");
t("131072 出現在 3 個分組", dup.length === 3, dup.join(","));
for (const id of dup) {
  sel.value = id; fire(sel, "change");
  t(`選 ${id} → 131072 且 value 未被搶`, ctxVal() === 131072 && sel.value === id,
    `${sel.value}=${ctxVal()}`);
}

console.log("\n== 5. 範本 → 選單連動 ==");
const expect = { rag: [16384, 16, 8], human: [4096, 48, 10], doc: [131072, 4, 6] };
for (const [k, [c, u, f]] of Object.entries(expect)) {
  clickScn(k);
  t(`範本 ${k}: ctx=${c} users=${u} frag=${f}`,
    ctxVal() === c && +$("users").value === u && +$("frag").value === f,
    `${ctxVal()}/${$("users").value}/${$("frag").value}`);
  t(`範本 ${k}: 只有自己 pressed`, pressed().length === 1 && pressed()[0] === k, pressed().join(","));
  t(`範本 ${k}: 自訂框保持隱藏`, $("ctxCustom").hidden === true);
}

console.log("\n== 6. 手動改值 → 取消 pressed(修正的既有 bug)==");
clickScn("rag");
sel.value = "code-1m"; fire(sel, "change");
t("改選單後 pressed 清空", pressed().length === 0, pressed().join(","));

clickScn("rag");
$("users").value = "99"; fire($("users"), "input");
t("改 users 後 pressed 清空", pressed().length === 0, pressed().join(","));

clickScn("rag");
$("frag").value = "20"; fire($("frag"), "input");
t("改 frag 後 pressed 清空", pressed().length === 0, pressed().join(","));

clickScn("doc");
t("改架構欄位前 doc 仍 pressed", pressed().join(",") === "doc");
$("layers").value = "40"; fire($("layers"), "input");
t("改架構欄位不影響 pressed(僅切 custom 模型)",
  pressed().join(",") === "doc" && $("model").value === "custom", pressed().join(","));

console.log("\n== 7. 自訂模式 ==");
sel.value = "custom"; fire(sel, "change");
t("選自訂 → 輸入框顯示", $("ctxCustom").hidden === false);
$("ctxCustom").value = "45000"; fire($("ctxCustom"), "input");
t("自訂值 45000 生效", ctxVal() === 45000, String(ctxVal()));
$("ctxCustom").value = "99999999"; fire($("ctxCustom"), "input");
t("自訂值夾到上限 10,000,000", ctxVal() === 10000000, String(ctxVal()));
$("ctxCustom").value = "1"; fire($("ctxCustom"), "input");
t("自訂值夾到下限 128", ctxVal() === 128, String(ctxVal()));
sel.value = "rag-16k"; fire(sel, "change");
t("切回選項 → 輸入框隱藏且值回 16384",
  $("ctxCustom").hidden === true && ctxVal() === 16384, String(ctxVal()));

console.log("\n== 8. 設定碼 round-trip ==");
for (const [id, want] of [["agent-64k", 65536], ["code-1m", 1048576], ["chat-2k", 2048]]) {
  sel.value = id; fire(sel, "change");
  const code = ev("cfgEncode()");
  sel.value = "chat-8k"; fire(sel, "change");
  ev(`cfgApply(${JSON.stringify(code)})`);
  t(`設定碼還原 ${id}`, ctxVal() === want, String(ctxVal()));
}
sel.value = "custom"; fire(sel, "change");
$("ctxCustom").value = "70000"; fire($("ctxCustom"), "input");
const customCode = ev("cfgEncode()");
sel.value = "chat-8k"; fire(sel, "change");
ev(`cfgApply(${JSON.stringify(customCode)})`);
t("設定碼還原自訂值 70000", ctxVal() === 70000 && sel.value === "custom", `${sel.value}=${ctxVal()}`);

console.log("\n== 9. 舊版設定碼相容(ctx 為數字字串)==");
const legacy = o => Buffer.from(JSON.stringify(o), "utf8").toString("base64");
const applyLegacy = o => ev(`cfgApply(${JSON.stringify(legacy(o))})`);
applyLegacy({ m: "qwen38-27b", w: "fp16", k: "fp16", ctx: "131072", users: "8", frag: "8" });
t("舊碼 ctx=131072 → 對到選項", ctxVal() === 131072 && sel.value !== "custom", `${sel.value}=${ctxVal()}`);
applyLegacy({ m: "qwen38-27b", w: "fp16", k: "fp16", ctx: "12345", users: "8", frag: "8" });
t("舊碼非選單值 12345 → 落到自訂",
  ctxVal() === 12345 && sel.value === "custom" && $("ctxCustom").hidden === false, `${sel.value}=${ctxVal()}`);

console.log("\n== 10. 計算結果仍隨 ctx 變動 ==");
applyLegacy({ m: "qwen38-27b", w: "fp16", k: "fp16", ctx: "8192", users: "16", frag: "8" });
const kvAt8k = snapRow("KV Cache");
sel.value = "doc-128k"; fire(sel, "change");
const kvAt128k = snapRow("KV Cache");
t("128K 的 KV 為 8K 的 16 倍", Math.abs(kvAt128k / kvAt8k - 16) < 0.01,
  `${kvAt8k.toFixed(3)} → ${kvAt128k.toFixed(3)} (${(kvAt128k / kvAt8k).toFixed(2)}x)`);
t("snapshot.ctx 為數值非 id", ev("lastSnapshot.ctx") === 131072, String(ev("lastSnapshot.ctx")));

console.log("\n== 11. 全選項 × 計算不炸 ==");
let bad = [];
for (const id of ev("CTX_OPTIONS.map(o => o.id)")) {
  sel.value = id; fire(sel, "change");
  const tot = snapRow("合計");
  if (!isFinite(tot) || tot <= 0) bad.push(id);
}
t("13 個選項全部算出有限正值", bad.length === 0, bad.join(","));

console.log("\n== 12. VRAM 單位標示一致(Review P1)==");
const gpuHtml = $("gpu").innerHTML;
t("GPU 表格不再出現裸 GB 標示", !/\d\s*GB</.test(gpuHtml),
  (gpuHtml.match(/\d+ GB</g) || []).join(","));
// 只數資料格(vram 欄與可用量欄),tagline 的「最高 128 GiB」不算在內
t("VRAM 與可用量兩欄都標 GiB",
  (gpuHtml.match(/<td class="vram">[\d.]+ GiB<\/td>/g) || []).length === ev("GPUS.length") * 2,
  String((gpuHtml.match(/<td class="vram">[\d.]+ GiB<\/td>/g) || []).length));
// 標稱容量即為 GiB,不可再乘 10^9/2^30。若有人「修正」成十進位,96 會變 89.41
const pro6000 = ev("GPUS.find(g => g.name.includes('PRO 6000'))");
t("RTX PRO 6000 可用量維持 94 GiB(96 GiB − 2 GiB 保留)",
  pro6000.vram - pro6000.res === 94, String(pro6000.vram - pro6000.res));
t("CSV 表頭為 VRAM(GiB)", ev("(() => { $('copyCsv').onclick; return true })()") &&
  /VRAM\(GiB\)/.test(fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8")));

console.log("\n== 13. 主題三態(Review P2 方案 B)==");
t("載入後不設 data-theme(保留系統態)",
  d.documentElement.getAttribute("data-theme") === null,
  String(d.documentElement.getAttribute("data-theme")));
$("themeBtn").click();
t("第一次點擊 → 明確指定 dark(系統為 light 時)",
  d.documentElement.getAttribute("data-theme") === "dark",
  String(d.documentElement.getAttribute("data-theme")));
$("themeBtn").click();
t("再次點擊 → light", d.documentElement.getAttribute("data-theme") === "light",
  String(d.documentElement.getAttribute("data-theme")));
t("按鈕文字隨主題更新", $("themeTxt").textContent === "淺色", $("themeTxt").textContent);

console.log("\n== 14. 模型規格來源追溯(Review P3)==");
const models = ev("MODELS");
const noSrc = models.filter(m => m.id !== "custom" && !m.src).map(m => m.id);
t("28 個內建模型中 27 個有 src", models.length - 1 - noSrc.length === 27,
  `無 src: ${noSrc.join(",") || "(無)"}`);
t("唯一無 src 者為 qwen38-max", noSrc.length === 1 && noSrc[0] === "qwen38-max", noSrc.join(","));
t("無 src 者必須帶 q 註記說明",
  noSrc.every(id => /無官方公開權重/.test(models.find(m => m.id === id).q || "")));
t("所有 src 皆為 org/name 格式",
  models.filter(m => m.src).every(m => /^[\w.\-]+\/[\w.\-]+$/.test(m.src)),
  models.filter(m => m.src && !/^[\w.\-]+\/[\w.\-]+$/.test(m.src)).map(m => m.src).join(","));
$("model").value = "qwen38-27b"; fire($("model"), "change");
t("選中模型顯示 config.json 連結",
  /huggingface\.co\/Qwen\/Qwen3\.8-27B\/blob\/main\/config\.json/.test($("srcLink").innerHTML),
  $("srcLink").innerHTML);
t("連結有 rel=noopener", /rel="noopener noreferrer"/.test($("srcLink").innerHTML));
$("model").value = "qwen38-max"; fire($("model"), "change");
t("無 src 的模型明講「無官方公開權重」而非留白",
  /無官方公開權重/.test($("srcLink").textContent), $("srcLink").textContent);
$("layers").value = "40"; fire($("layers"), "input");
t("改架構欄位切為自訂 → 來源連結清空", $("srcLink").textContent === "", $("srcLink").textContent);

console.log("\n== 15. FP4_SUPPORT 對照 NVIDIA 官方 checkpoint ==");
// 依 NVIDIA dgx-spark-playbooks 的 Model Support Matrix,且已逐一打 HF API 驗證 repo 存在
const NV_NVFP4 = ["qwen36-35b", "qwen3-8b", "qwen3-14b", "qwen3-32b",
                  "gemma4-31b", "nemotron3-super", "qwen36-27b", "deepseek-v4-flash"];
NV_NVFP4.forEach(id => t(`${id} 可選 NVFP4`, ev(`fp4Ok(${JSON.stringify(id)},"nvfp4")`)));
// 反例:NVIDIA 支援表對 Gemma 4 26B 只列 Base,HF 上該 NVFP4 repo 回 401
t("gemma4-26b 不可選 NVFP4(官方無此 checkpoint)", !ev(`fp4Ok("gemma4-26b","nvfp4")`));
t("gpt-oss 仍只支援 MXFP4",
  ev(`fp4Ok("gptoss-120b","mxfp4") && !fp4Ok("gptoss-120b","nvfp4")`));

console.log("\n== 16. DGX Spark agent 範本(NVIDIA playbook 配置)==");
clickScn("agent");
t("模型切為 Qwen3.6 35B-A3B", $("model").value === "qwen36-35b", $("model").value);
t("權重精度為 NVFP4(未被 fp4Ok 靜默退回 FP8)",
  ev("state.wprec") === "nvfp4", ev("state.wprec"));
t("KV 精度為 FP8", ev("state.kvprec") === "fp8", ev("state.kvprec"));
t("ctx = 262,144(--max-model-len)", ctxVal() === 262144, String(ctxVal()));
t("並發 = 4(--max-num-seqs)", +$("users").value === 4, $("users").value);
t("prefill chunk = 8192(--max-num-batched-tokens)", +$("chunk").value === 8192, $("chunk").value);
t("套用範本不會把模型誤切為自訂", $("model").value !== "custom");
t("只有 agent 範本 pressed", pressed().length === 1 && pressed()[0] === "agent", pressed().join(","));
const agentTotal = snapRow("合計");
const agentW = snapRow("模型權重");
console.log(`   → 權重 ${agentW.toFixed(2)} GiB / 合計 ${agentTotal.toFixed(2)} GiB`);
// NVIDIA 用 --gpu-memory-utilization 0.4;128 GiB 的 40% = 51.2 GiB
t("合計落在 NVIDIA 的 40% 預算(51.2 GiB)內", agentTotal <= 51.2, agentTotal.toFixed(2));
// 若 NVFP4 退回 FP16,權重會從約 18 GiB 變成約 65 GiB —— 這是最關鍵的回歸點
t("權重約 18 GiB,證明走的是 NVFP4 而非 FP16",
  agentW > 15 && agentW < 22, agentW.toFixed(2));
const sparkFits = ev(`(() => {
  const g = GPUS.find(x => x.name.includes("GB10"));
  return lastSnapshot.gpus.find(r => r[0] === g.name);
})()`);
t("DGX Spark 單機可容(TP=1)", sparkFits && sparkFits[3] === 1, JSON.stringify(sparkFits));

console.log("\n== 17. 其餘三個範本未受影響 ==");
for (const [k, [c, u, f]] of Object.entries({ rag: [16384, 16, 8], human: [4096, 48, 10], doc: [131072, 4, 6] })) {
  clickScn(k);
  t(`範本 ${k} 仍為 ctx=${c} users=${u} frag=${f}`,
    ctxVal() === c && +$("users").value === u && +$("frag").value === f,
    `${ctxVal()}/${$("users").value}/${$("frag").value}`);
}
// 工作負載型範本不帶模型欄位,不該動到目前選的模型
$("model").value = "glm52"; fire($("model"), "change");
clickScn("rag");
t("純工作負載範本不覆蓋模型", $("model").value === "glm52", $("model").value);

console.log("\n== 18. 執行期無新錯誤 ==");
t("全程無 console.error / jsdomError", errors.length === 0, errors.join(" | "));

console.log(`\n結果: ${pass} 通過 / ${fail} 失敗\n`);
process.exit(fail ? 1 : 0);
