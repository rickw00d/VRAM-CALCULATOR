# VRAM 估算器 — 迴歸測試清單

改動 `index.html` 後,依此清單手動或用瀏覽器工具跑一遍。所有腳本可直接貼到 `preview_start` 開啟本機伺服器後的 console。

## 1. 基本冒煙測試

- [ ] 開啟頁面無 console 錯誤
- [ ] 預設模型(Qwen3.8 27B)顯示合理的 GiB 數字,非 NaN/Infinity
- [ ] 深色 / 淺色 / 系統預設(不設 `data-theme`)三種狀態顏色都正確,無透明背景透出

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
