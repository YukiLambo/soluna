# 曜 · Soluna 收費同 iOS app 設定步驟

iOS app 除咗網頁版內容，仲有手機先有嘅功能：每日信件提醒通知、桌面 widget（今日運勢）、Apple 登入同 App 內購買。Apple 審核指引 4.2 唔接受「只係包個網頁」嘅 app，呢幾樣就係用嚟過呢關。

程式碼已經寫好，下面係要你喺各個網站登入、撳掣、抄 key 嘅部分。由上到下做就得。

## 成個流程點運作

- **網頁版**：撳「解鎖」→ Stripe 付款頁（信用卡、Apple Pay、Google Pay）→ Stripe 通知 Cloudflare Worker → Worker 更新 Firestore `users/{uid}` → app 即時見到解鎖。
- **iPhone app**：撳「解鎖」→ Apple 付款（RevenueCat 處理）→ RevenueCat 通知同一個 Worker → 更新 Firestore → 解鎖。
- 兩邊共用同一個帳戶：網頁買咗，iPhone 登入一樣見到解鎖（app 入面冇任何「去網頁買」嘅字眼，符合 Apple 規定）。
- 價錢寫死喺 Worker 度（`server/deepseek-worker.js` 嘅 `CATALOG`），用戶喺瀏覽器改唔到。Sol Pro 會員買單次報告同合盤有 8 折。
- 同一個付款通知收兩次都唔會重複入帳（Firestore `payments/` 記住處理過嘅通知）。

## 1. Firebase（5 分鐘）

1. Authentication › Sign-in method：開 **電郵/密碼**、**Google**、**Apple**。
2. Authentication › Settings › Authorized domains：加 `yukilambo.github.io`。
3. Firestore Database：建立（地區揀 `asia-east2` 香港）。Rules 分頁貼上 repo 入面 `firestore.rules` 嘅內容，撳發佈。
4. 專案設定 › 服務帳戶 › 「產生新的私密金鑰」，下載個 JSON（第 3 步用，**唔好放上 GitHub**）。

## 2. Cloudflare Worker（10 分鐘）

1. 喺 cloudflare.com 開免費帳戶 › Workers & Pages › Create › Worker，改名 `soluna`。
2. Edit code：將 repo 嘅 `server/deepseek-worker.js` 成個貼入去，Deploy。
3. Settings › Variables and Secrets，加：
   - Text：`FIREBASE_PROJECT_ID` = `soluna-71703`
   - Text：`ALLOWED_ORIGIN` = `https://yukilambo.github.io`
   - Text：`APP_URL` = `https://yukilambo.github.io/soluna/`
   - Secret：`DEEPSEEK_API_KEY`（DeepSeek 控制台）
   - Secret：`GOOGLE_SA_JSON`（第 1 步下載嘅 JSON，成段貼入去）
   - Secret：`STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET`（第 3 步）
   - Secret：`RC_WEBHOOK_AUTH`（自己作一串長密碼，第 4 步都要用）
4. 抄低 Worker 網址（例如 `https://soluna.你的名.workers.dev`），話我知，我會填入 `firebase-config.js` 嘅 `SOLUNA_AI_ENDPOINT`。

## 3. Stripe（網頁收錢）

1. stripe.com 開帳戶，國家揀香港，完成商戶驗證（身份證、銀行戶口）。
2. Developers › API keys：抄 **Secret key**（`sk_live_…`，測試時用 `sk_test_…`）→ Worker 嘅 `STRIPE_SECRET_KEY`。
3. Developers › Webhooks › Add endpoint：
   - URL：`https://你的worker網址/stripe-webhook`
   - Events：`checkout.session.completed`、`checkout.session.async_payment_succeeded`、`customer.subscription.updated`、`customer.subscription.deleted`
   - 抄 Signing secret（`whsec_…`）→ Worker 嘅 `STRIPE_WEBHOOK_SECRET`。
4. Settings › Payment methods：開 Cards、Apple Pay、Google Pay（Apple Pay 要喺 Payment method domains 加 `yukilambo.github.io`）。
5. Settings › Billing › Customer portal：開啟，等會員可以自己取消訂閱。
6. 年費計劃已經設定咗 7 日免費試用，唔使喺 Stripe 另外整產品。

**測試**：用 `sk_test_` key，卡號 `4242 4242 4242 4242`、任何未來日期、任何 CVC。

## 4. Apple Developer + App Store Connect

1. 加入 Apple Developer Program（每年 US$99）。
2. Certificates, IDs & Profiles › Identifiers：
   - 新增 **App Group** `group.app.soluna.ios`（app 同 widget 共用今日運勢資料）。
   - 新增 App ID `app.soluna.ios`，勾選 **Sign in with Apple**、**In-App Purchase**、**App Groups**（揀上面個 group）。
   - 新增 App ID `app.soluna.ios.widget`（桌面 widget），勾選 **App Groups**（同一個 group）。
3. App Store Connect › 我的 App › 新增 App（Bundle ID `app.soluna.ios`）。
4. 營利 › 訂閱：建立訂閱群組「Soluna 會員」，入面加 4 個（產品 ID 一定要跟呢個名）：
   - `soluna_luna_month`（HK$28 / 月）
   - `soluna_luna_year`（HK$198 / 年，介紹優惠：7 日免費）
   - `soluna_sol_month`（HK$58 / 月）
   - `soluna_sol_year`（HK$398 / 年，介紹優惠：7 日免費）
5. 營利 › App 內購買項目：
   - 非消耗性：`soluna_love`、`soluna_career`、`soluna_money`、`soluna_soul`（HK$38）、`soluna_year`（HK$98）、`soluna_decade`（HK$128）
   - 消耗性：`soluna_compat`（HK$48，每買一次解鎖一個人）、`soluna_p5`（HK$18）、`soluna_p15`（HK$45）、`soluna_p40`（HK$98）
6. 協議、稅務及銀行業務：簽「付費 App」協議，填銀行同稅務資料（未簽就收唔到錢，亦測試唔到購買）。

## 5. RevenueCat

1. revenuecat.com 開帳戶 › 新增 Project › 加 App Store app（Bundle ID `app.soluna.ios`）。
2. 跟佢指示上載 App Store Connect 嘅 **In-App Purchase Key**（App Store Connect › 用戶與存取權限 › 整合 › App 內購買項目）。
3. Products：撳 Import，將上面 14 個產品匯入。
4. Entitlements：建立 `luna` 同 `sol`，分別掛上對應嘅訂閱（用嚟喺 RevenueCat 睇報表，解鎖係睇 Firestore）。
5. Integrations › Webhooks：
   - URL：`https://你的worker網址/rc-webhook`
   - Authorization header：`Bearer ` + 你喺第 2 步作嘅 `RC_WEBHOOK_AUTH`
6. API keys：抄 **Public app-specific key**（`appl_…`），話我知，我會填入 `SOLUNA_RC_IOS_KEY`。
7. 測試期間如果想 Sandbox 購買都會解鎖，喺 Worker 加 Text 變數 `RC_ALLOW_SANDBOX` = `1`；上架前刪除。

## 6. 喺 Mac 用 Xcode 起 iOS app

需要：Mac、Xcode 16.3 或以上、Node 20 或以上。

```bash
git clone https://github.com/YukiLambo/soluna.git
cd soluna/ios-app
npm install
npm run sync      # 將網頁版複製入 app，再更新 iOS 項目
npm run open      # 開 Xcode
```

喺 Xcode：

1. Firebase 控制台 › 專案設定 › 新增 iOS 應用程式（Bundle ID `app.soluna.ios`），下載 `GoogleService-Info.plist`，拖入 Xcode 左邊嘅 `App/App` 資料夾（勾選 Copy items）。
2. 打開 `App/App/Info.plist`，將 `com.googleusercontent.apps.REPLACE_ME` 換成 `GoogleService-Info.plist` 入面嘅 `REVERSED_CLIENT_ID`（Google 登入要用）。
3. 撳左邊最頂嘅 App 專案 › Signing & Capabilities：`App` 同 `SolunaWidget` 兩個 target 都揀你嘅 Team（Sign in with Apple、App Groups 已經寫入 entitlements 檔）；`App` 再撳 `+ Capability` 加 **In-App Purchase**。
4. 揀一部 iPhone 或者模擬器，撳 ▶ 試行。
5. 測試購買：App Store Connect › 用戶與存取權限 › Sandbox 測試員，開一個測試 Apple ID，喺 iPhone 設定 › App Store › 沙盒帳戶登入。
6. 上架：Product › Archive › Distribute App › App Store Connect，再喺 App Store Connect 填截圖、描述、私隱政策網址，提交審核。

每次網頁版有更新，喺 `ios-app` 再行一次 `npm run sync`，然後重新 Archive。

## 7. 冇 Mac：用 GitHub Actions 喺雲端編譯同上載

Repo 已經有 `.github/workflows/ios.yml`。GitHub 會用佢哋嘅 Mac 幫你編譯，再直接上載去 TestFlight。

1. 先做好第 4 步（App ID、App Group、App Store Connect 入面建立 App）。
2. App Store Connect › 用戶與存取權限 › 整合 › App Store Connect API › 產生 API 密鑰（權限揀 **App 管理**）。抄低 **Key ID**、**Issuer ID**，下載 `.p8` 檔（只可以下載一次）。
3. Apple Developer › Membership details 抄低 **Team ID**。
4. GitHub repo › Settings › Secrets and variables › Actions › New repository secret，加 5 個：
   - `ASC_KEY_ID`：Key ID
   - `ASC_ISSUER_ID`：Issuer ID
   - `ASC_KEY_P8`：`.p8` 檔轉做 base64（Mac/Linux：`base64 -i AuthKey_XXXX.p8`；Windows PowerShell：`[Convert]::ToBase64String([IO.File]::ReadAllBytes("AuthKey_XXXX.p8"))`）
   - `APPLE_TEAM_ID`：Team ID
   - `GOOGLE_SERVICE_INFO_PLIST`：Firebase 下載嘅 `GoogleService-Info.plist` 轉做 base64（方法同上）
5. GitHub repo › Actions › **iOS build** › Run workflow。大約 15 至 25 分鐘之後，App Store Connect 嘅 TestFlight 會見到新版本，用 iPhone 裝 TestFlight app 就試得。
6. 每次網頁版更新完，再撳一次 Run workflow 就會出新版本（版本號自動加 1）。

GitHub 免費帳戶每月有 Mac 編譯分鐘數（私人 repo 會用得快啲，公開 repo 免費）。想用 Codemagic 都得，佢免費版每月 500 分鐘，設定同樣要上面嗰幾個 key。

## 手機先有嘅功能

- **每日信件提醒**：第一次收信之後，app 會問可唔可以通知。預設每晚 9 點提你記低心情，可以喺「我的 › 設定 › 每日信件提醒」改時間或者關閉。當日已經收咗信就唔會再提。通知喺部機度排程，唔使伺服器。
- **桌面 widget**：長按桌面 › 撳 + › 搵「曜 Soluna」，有細同中兩個尺寸。顯示今日嘅旺、平、煩、忌、一句提醒，同埋最旺同要留神嘅方面。App 每次打開會預先計好未來 7 日，所以過咗午夜唔使開 app 都會自動轉日。

## Apple 審核會睇嘅位（已經做咗）

- iOS app 入面冇「去網頁買」嘅字眼或者連結。
- 商店頁有「回復購買」掣同自動續訂說明。
- 有 Google 登入就要有 **Apple 登入**：iOS 版已加。
- 設定頁有 **刪除帳戶**。
- 影相同揀相有中文用途說明。
- 內容寫明「供娛樂同自我反思之用」。
- 有手機先有嘅功能（通知、widget、Apple 登入、內購），唔係淨係包個網頁。
