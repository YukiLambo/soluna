# 曜 · Soluna 占星同預測知識庫

呢度記低 Yuki 提供嘅書同筆記入面所有「點樣分析」嘅規則，用嚟令 app 嘅占星、命理同預測更準確。

- 全部用自己嘅說話重新整理，唔係原文抄錄；app 入面唔會顯示出處。
- 每條規則旁邊註明 app 入面邊個功能用到（`程式：` 後面係 `index.html` 入面嘅函數名），方便核對同修改。
- 新增或者修改規則：先改呢度，再改程式，最後喺「更新紀錄」加一行。

## 目錄

| 檔案 | 內容 | 主要來源 |
|---|---|---|
| [01-horary.md](01-horary.md) | 卜卦占星 | John Frawley《The Horary Textbook》 |
| [02-electional.md](02-electional.md) | 擇日占星 | 擇日占星講義（Dykes、Lehman 等）、Yuki 嘅筆記 |
| [03-transits-forecast.md](03-transits-forecast.md) | 行運、宇宙生物學、月相、小限、回歸、推運 | Reinhold Ebertin 宇宙生物學行運；主流行運容許度 |
| [04-natal-western.md](04-natal-western.md) | 西洋本命：尊貴、日夜派、宇宙藍圖、事業公式 | William Lilly 古典尊貴；Tanaaz Chubb；第十宮事業框架；Sepharial |
| [05-ziwei.md](05-ziwei.md) | 紫微斗數 | 《紫微斗數全書》、令東來《紫微斗數命理學》、紫微白娘子飛星四化 |
| [06-bazi.md](06-bazi.md) | 八字 | 《子平真詮》、《三命通會》 |
| [07-scoring.md](07-scoring.md) | 每日／每月運勢點樣計分 | Yuki 嘅計分藍圖（設計，非古籍） |
| [08-oracles.md](08-oracles.md) | 塔羅、梅花易數、神占、面相手相、Ifá、盧恩、解夢 | Golden Dawn 對應、邵雍、麻衣／柳莊／冰鑑、Benham 等 |
| [09-voice.md](09-voice.md) | 寫解讀嘅語氣同規矩 | Yuki 嘅指示 |

## AI 解讀點樣用呢啲規則

DeepSeek 解讀嘅提示（`prompt()`）會按任務自動加入相關規則：卜卦同擇日用 `HZ_RULES`，運勢同計劃用 `EB_RULES`，事業同天賦用 `CAREER_RULES`，紫微用 `ZW_RULES`。改咗呢度嘅規則，記得同步改呢幾段文字。

## 星曆同計算原則

- 行星位置用 astronomy-engine（MIT 授權），喺瀏覽器計，唔用 Swiss Ephemeris（AGPL 同收費 app 有衝突）。
- 本命盤預設 Placidus（設定可轉整宮制）；卜卦同擇日一律 Regiomontanus。
- 黃道係回歸黃道（tropical）。

## 原書

Yuki 上載嘅原書只留喺專案私人上載區，唔放入呢個公開 repo；呢度只存歸納咗嘅規則。

## 更新紀錄

- 2026-11-28：建立知識庫，收錄 Frawley 卜卦、擇日、Ebertin 宇宙生物學、Tanaaz Chubb、第十宮事業框架，同埋之前已經用緊嘅古典占星、紫微、八字、計分、占卜規則。
- 2026-11-28：加入令東來《紫微斗數命理學》推算原則、紫微白娘子飛星四化（生年祿忌、命祿忌、祿轉忌、三宮交祿、忌沖、相應）、擇日講義（消散月、錯失月亮相位、恆星上軸、行星時用法、起點同地點原則）。
