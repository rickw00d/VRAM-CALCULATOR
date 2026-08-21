# VRAM 估算器 — 迴歸測試清單

改動 `index.html` 後,依此清單手動或用瀏覽器工具跑一遍。所有腳本可直接貼到 `preview_start` 開啟本機伺服器後的 console。

## 1. 基本冒煙測試

- [ ] 開啟頁面無 console 錯誤
- [ ] 預設模型(Qwen3.8 27B)顯示合理的 GiB 數字,非 NaN/Infinity
- [ ] **主題三態**:載入後 `document.documentElement` 應**沒有** `data-theme` 屬性(系統態,由 CSS
      `prefers-color-scheme` 決定);按一次切換鈕才寫入 `light`/`dark`。三種狀態顏色都正確,無透明背景透出。
      在 OS 主題設定與頁面之間來回切換,系統態下按鈕圖示要跟著變

```js
// 系統態驗證:重新載入後應印出 null
console.log(document.documentElement.getAttribute('data-theme'));
```

## 2. 全模型 × 全精度掃描(零錯誤是底線)

```js
const sel=document.getElementById('model');
document.getElementById('showOld').checked=true;
document.getElementById('showOld').dispatchEvent(new Event('change'));
const errors=[];
for(const o of sel.querySelectorAll('option')){
  if(o.value==='custom') continue;
  sel.value=o.value; sel.dispatchEvent(new Event('change'));
  for(const b of [...document.querySelectorAll('#wprec button')]){
    if(b.disabled) continue;
    b.click();
    const t=document.getElementById('totalGB').textContent;
    const bd=[...document.querySelectorAll('#bd tr')].map(x=>x.cells[1].textContent).join('|');
    if(/NaN|Infinity|undefined/.test(t+bd)) errors.push(o.text+'/'+b.textContent);
  }
}
console.log(errors.length?errors:'全數通過');
```

## 3. 分解表自洽性(加總必須等於合計、長條圖必須等於 100%)

```js
const rows=[...document.querySelectorAll('#bd tr')].map(r=>parseFloat(r.cells[1].textContent));
const parts=rows.slice(0,4).reduce((a,b)=>a+b,0);
const barW=[...document.querySelectorAll('#bar span')].reduce((a,s)=>a+parseFloat(s.style.width),0);
console.log({加總:parts.toFixed(1), 合計:rows[4], 長條寬度:barW.toFixed(1)}); // 加總≈合計,長條寬度≈100
```

## 4. 混合注意力 KV 層別計算

- [ ] 選一個有滑窗的模型(Gemma 4 31B),把 ctx 拉到超過視窗大小(如 131072),KV Cache 那列要出現「滑窗封頂」字樣
- [ ] 選一個 MLA 模型(DeepSeek/GLM/Kimi),`totalCap` 要顯示「MLA 路徑」而非「GQA/MHA 路徑」
- [ ] 新版 Qwen3.8-27B 的 KV(16 全注意力層)應明顯小於舊版 Qwen3-32B(64 層全注意力)—— 這是驗證「總層數 ≠ 有 KV 層數」修正有沒有退化的關鍵指標

## 5. FP4 精度支援表

```js
// gpt-oss 系列只該有 MXFP4,不該有 NVFP4
document.getElementById('model').value='gptoss-120b';
document.getElementById('model').dispatchEvent(new Event('change'));
console.log([...document.querySelectorAll('#wprec button')].map(b=>b.textContent+(b.disabled?'✗':'✓')));
```

- [ ] 在支援 FP4 的模型上選中 NVFP4/MXFP4 後,切換到不支援的模型,精度要自動退回 FP8(不可停在無效狀態)
- [ ] **關鍵回歸點**:選一個不支援 FP4 的模型(如 GLM-5.2),編輯任一架構欄位(如「總層數」)使其切換為「自訂」,NVFP4/MXFP4 按鈕必須立刻變成可選(自訂模型兩者皆支援)—— 這是 P3 修過的 bug,若按鈕仍顯示劃掉即為退化

## 6. 邊界防呆警告

```js
document.getElementById('model').value='custom';
document.getElementById('model').dispatchEvent(new Event('change'));
document.getElementById('layers').value=10; document.getElementById('layers').dispatchEvent(new Event('input'));
document.getElementById('lfull').value=8; document.getElementById('lfull').dispatchEvent(new Event('input'));
document.getElementById('lswa').value=8; document.getElementById('lswa').dispatchEvent(new Event('input'));
console.log(document.getElementById('archWarn').textContent); // 應警告「層數設定互相矛盾」
```

- [ ] 全注意力層 + 滑窗層 > 總層數 → 出現紅字警告
- [ ] 滑窗層 > 0 但視窗大小 = 0 → 出現紅字警告
- [ ] 切回任一內建模型,警告要清空
- [ ] 條件排除後(改回合理數字),警告要消失

## 7. 設定碼 round-trip

```js
const sel=document.getElementById('model');
sel.value='deepseek-v4-flash'; sel.dispatchEvent(new Event('change'));
[...document.querySelectorAll('#wprec button')].find(b=>b.textContent==='FP8').click();
const before=document.getElementById('totalGB').textContent, code=cfgEncode();
sel.value='qwen38-27b'; sel.dispatchEvent(new Event('change')); // 干擾
cfgApply(code);
console.log({before, after:document.getElementById('totalGB').textContent}); // 應相等
```

- [ ] 舊世代模型的設定碼要能自動勾選「顯示舊世代模型」並正確還原

## 7.5 上下文長度下拉選單(`CTX_OPTIONS` / `SCN`)

完整自動化測試在 jsdom 下跑,共 44 項:

```powershell
# 一次性:npm install jsdom --no-save
node ctx-test.js   # 腳本見本節末尾說明
```

console 快速版:

```js
// 三個範本的 ctx 必須都能在選單中找到,否則點範本會靜默套不上值
console.log(Object.entries(SCN).map(([k,s]) =>
  `${k}: ${s.ctx} ${CTX_OPTIONS.some(o=>o.id===s.ctx)?'✓':'✗ 不在 CTX_OPTIONS'}`));
// 128K 在三個分組各出現一次,選任一個都必須拿到 131072 且 value 不被別組搶走
for(const id of ['agent-128k','doc-128k','code-128k']){
  ctx.value=id; ctx.dispatchEvent(new Event('change'));
  console.log(id, ctx.value===id, getCtx()===131072);
}
```

- [ ] 選單為 6 個 optgroup(對話/檢索/**Agent 最低需求**/**Agent 實機配方**/長文件/程式開發)+「自訂…」
- [ ] **兩個 Agent 分組必須相鄰**:`buildCtxList` 依 `g` 值變化切 optgroup,中間插別組會讓同名分組被切成兩塊
- [ ] 「最低需求」與「實機配方」不得合併:前者是軟體不讓你低於的硬門檻,
      後者是實際跑過的配置,混在一組會被誤讀成同一種東西的四個級距
- [ ] **選單 value 是 id 不是數字** —— 131072 在三組重複出現,用數字當 value 會永遠選到第一個
- [ ] 點三個範本後,ctx 分別為 4096 / 16384 / 131072,且只有被點的那顆 `aria-pressed="true"`
- [ ] **關鍵回歸點**:點任一範本後手動改 ctx / users / frag,範本按鈕的 pressed 狀態必須清空 —— 此時數值已不等於範本的三值組合,若仍亮著即為 P4 修過的 bug 復發
- [ ] 改「架構欄位」不該清空 pressed(那只切換為自訂模型,與工作負載無關)
- [ ] 選「自訂…」才顯示數字輸入框,範圍仍為 128–10,000,000(超出要被夾住)
- [ ] 設定碼存的是**解析後的數值**而非 id;舊版(ctx 還是 number input 時)的設定碼仍要能還原,數值對得上選項就選它、對不上就落到自訂
- [ ] 選單標籤中不得出現影片/生圖選項 —— 擴散模型為雙向注意力、不保留 KV Cache,本頁公式對其不適用(詳見「已知限制」)

## 7.6 VRAM 單位一致性(GB / GiB)

**加速卡標稱的「96GB」本身就是 96 GiB**,不是十進位 96×10⁹ bytes。顯示記憶體以 2 的冪次顆粒組成,
nvidia-smi 對「80GB」H100 回報 81,920 MiB(= 80 GiB)。因此 `g.vram - g.res` 是同單位相減,**正確**。

- [ ] **反向回歸點**:若有人把 `vram` 當十進位 GB「修正」成 `× 10⁹ / 2³⁰`,每張卡會被低估 6.9%
      (RTX PRO 6000 可用量會從 94 GiB 掉到 87.41 GiB),落在 88–94 GiB 的配置會從「單卡可容」
      被誤判為「需 2×」。此為誤修,不是修正
- [ ] GPU 表格的 VRAM 與可用量兩欄都標 `GiB`,表格內不得出現裸 `GB`
- [ ] CSV 表頭為 `VRAM(GiB)`
- [ ] 頁尾說明保留「加速卡標稱容量本身即為 2³⁰ 進位」那段(這個誤解很容易重複踩到)

## 7.7 模型規格來源追溯(`src` 欄位)

```js
// 全部 src 應可解析且回應 200(需網路;逐一打 HF API)
(async()=>{for(const m of MODELS.filter(m=>m.src)){
  const r=await fetch(`https://huggingface.co/api/models/${m.src}`); // 不可用 encodeURIComponent,會把 / 編成 %2F
  if(r.status!==200) console.warn('✗',m.id,m.src,r.status);
}console.log('src 檢查完成')})();
```

- [ ] 28 個內建模型中 27 個有 `src`,唯一例外是 Qwen3.8-Max(無官方公開權重,僅第三方蒸餾/量化)
- [ ] 無 `src` 者必須在 `q:` 中明講「無官方公開權重」,UI 也要顯示該說明而非留白
- [ ] NVIDIA 兩個 Nemotron 指向 `-BF16` 版 —— 無後綴的 repo 需授權(HF API 回 401)
- [ ] 選中模型時 `#srcLink` 顯示指向 `config.json` 的連結,且帶 `rel="noopener noreferrer"`
- [ ] 編輯任一架構欄位切換為「自訂」後,來源連結必須清空(已偏離內建規格,連結不再成立)
- [ ] 模型規格會隨新版本變動,`src` 是下次校驗的起點,不是「永久正確」的保證

## 7.8 FP4_SUPPORT 與 DGX Spark agent 範本

`FP4_SUPPORT` 的權威來源是 NVIDIA dgx-spark-playbooks 的
[vLLM Model Support Matrix](https://github.com/NVIDIA/dgx-spark-playbooks/blob/main/nvidia/vllm/README.md)。
**注意 `build.nvidia.com` 是 SPA,WebFetch 會逾時 —— 要讀原始 markdown 走
`raw.githubusercontent.com`。**

```js
// 逐一驗證 NVFP4 標記都有對應的官方 checkpoint(需網路)
const NV = {"qwen36-35b":"nvidia/Qwen3.6-35B-A3B-NVFP4","qwen3-8b":"nvidia/Qwen3-8B-NVFP4",
 "qwen3-14b":"nvidia/Qwen3-14B-NVFP4","qwen3-32b":"nvidia/Qwen3-32B-NVFP4",
 "gemma4-31b":"nvidia/Gemma-4-31B-IT-NVFP4","qwen36-27b":"nvidia/Qwen3.6-27B-NVFP4"};
(async()=>{for(const [id,repo] of Object.entries(NV)){
  const r=await fetch(`https://huggingface.co/api/models/${repo}`); // 不可用 encodeURIComponent
  console.log(fp4Ok(id,'nvfp4')?'✓':'✗', id, repo, r.status);
}})();
```

- [ ] **最關鍵的回歸點**:點「本地 Agent(DGX Spark)」範本後,**權重應約 18 GiB、合計約 32 GiB**。
      若權重跳到 ~65 GiB、合計 ~83 GiB,表示 `FP4_SUPPORT` 又漏了 `qwen36-35b`,
      NVFP4 被 `fp4Ok()` 擋下並**靜默退回 FP16** —— 這種失敗不會報錯,只會算出錯誤答案
- [ ] Gemma 4 26B-A4B **不可**選 NVFP4(NVIDIA 支援表對它只有 Base,HF 的 NVFP4 repo 回 401)
- [ ] gpt-oss 20B/120B 仍只支援 MXFP4,不得出現 NVFP4
- [ ] 全模型×全精度掃描應為 **153** 組(修此表前為 149,四個新增模型各 +1)
- [ ] agent 範本應同時設定 model / wprec / kvprec / ctx / users / frag / chunk 七項
- [ ] **順序回歸點**:`applyModel()` 內會呼叫 `normalizeWprec()` 重建精度按鈕並可能退回 FP8,
      所以範本套用時模型必須先於精度。若順序顛倒,wprec 會被覆蓋成 FP8 而測試會抓到權重變大
- [ ] 前三個工作負載範本(rag/human/doc)**不帶** model 欄位,點它們不該覆蓋使用者已選的模型
- [ ] 啟動斷言:若某範本要求的 wprec 在 `FP4_SUPPORT` 中該模型不支援,console 要報錯

## 7.9 版面 / 互動測試(真實瀏覽器)

```bash
npm test          # jsdom,87 項:資料與邏輯
npm run test:visual   # 真實瀏覽器,65 項:版面與互動
npm run test:all      # 兩者
```

**為什麼需要第二套**:jsdom 不做版面計算也不套用 CSS。踩過一次 ——
tooltip 用了 `.tipbtn:hover + .tip`(緊鄰手足),但 DOM 上兩者中間隔著 `#fragv`,
選擇器永遠不命中、面板從頭到尾是死的,而當時 60 項 jsdom 測試**全過**。
凡是「CSS 決定看不看得見」的行為,jsdom 一律測不到。

`test/visual.js` 自帶靜態伺服器(系統分配臨時埠,不必另裝 http-server、
不會和開發時的 8123 撞埠),並優先借用系統已安裝的 Edge / Chrome,
沒有才退回 `npx playwright install chromium`。

- [ ] 新增說明面板時,在 `test/visual.js` 的 `TIPS` 補一行即可
- [ ] **開啟方向是動態的**,不要斷言固定方向。面板高度固定但按鈕位置隨捲動而變,
      JS 依剩餘空間翻轉 `.tip-up`;`checkAutoFlip` 會把按鈕捲到頂/中/底三個位置各驗一次
- [ ] 若下方空間不足卻沒翻轉,面板會有一截在畫面外 —— 且此時捲動就會離開按鈕、
      面板隨即收起,那截**永遠讀不到**。這正是加入 auto-flip 的原因
- [ ] 只驗「收起後不留隱形遮罩」,**不要**驗「開啟時底下元素可點」:
      游標一離開按鈕面板就消失,同時 hover 按鈕又操作底下元素在真實使用中不存在,
      那樣斷言只會製造假失敗(寫測試時踩過)
- [ ] 鍵盤測試必須用**真實 Tab 按鍵**,不可用程式化 `.focus()`:
      焦點可見性取決於最後一次輸入方式,滑鼠操作後再呼叫 `.focus()`
      不會觸發 `:focus-visible`,會得到假失敗(同樣踩過)

## 8. 匯出

- [ ] 「複製 CSV」後貼上內容,KV/權重精度欄要是人看得懂的標籤(`FP16`),不是內部 id(`fp16`)
- [ ] 「複製設定碼」→「載入設定碼」輸入框可用 Enter 送出、Esc 取消

## 9. 響應式

```js
// 需搭配 resize_window 工具設成 375×812 (mobile) 後執行
const de=document.documentElement;
console.log({溢出:de.scrollWidth>de.clientWidth, 寬度:`${de.clientWidth}/${de.scrollWidth}`});
```

- [ ] 手機寬度(375px)下無橫向溢出,GPU 表格在自己的容器內捲動而非撐開版面

## 10. GPU 落點與電費

- [ ] 統一記憶體機種(RTX Spark / Jetson Thor / EdgeXpert)`maxN` 應為 2,其餘應為 8
- [ ] `年電費` 欄位金額 ≥ 1,000,000 時要用 `X.XXM` 格式顯示,而非全部位數
- [ ] 無任何配置可容納時,推薦配置卡片要顯示「尚無可行配置」而非空白或報錯

---

## 已知限制(非 bug,設計如此)

- DeepSeek V4 Flash/Pro 的 `layer_types` 未公開,以全部層數保守估算 KV(見 `index.html` 內 `q:` 欄位註記)
- 電費估算未含主機、散熱、PUE,僅計加速卡本身
- 4-bit 支援表(`FP4_SUPPORT`)會隨新量化 checkpoint 釋出而過時,需人工更新
- **本頁不涵蓋影片/生圖生成**。MiniMax H3、LTX-2.5 等擴散模型為雙向全時空自注意力,
  每個去噪步驟重算全序列、不累積 KV Cache,`2 × KVheads × headdim × …` 公式對其不成立
  (H3 模型卡提到的 cache 是 AdaLN 調變參數預算快取,與注意力 KV 無關)。
  且同一支 1080p/5 秒影片的序列長度隨模型相差 7.5 倍 —— LTX-2.5 約 32K(32× 空間 / 8× 時間)、
  MiniMax H3 約 61K(32× / 4×)、HunyuanVideo 1.5 約 245K(16× / 4×),不存在可寫進選單的單一數字。
  唯一適用本頁公式的是**自迴歸**影片模型(如 LongCat-Video:5 秒 480p / 38K tokens / KV Cache 34GB)。
- jsdom 未實作 `matchMedia`,自動化測試需在 `beforeParse` 補 stub(真實瀏覽器有,非頁面缺陷)。
  另注意頁面 top-level 的 `const`/`let` 綁定不會掛到 `window`,測試需經 `window.eval()` 取用。
