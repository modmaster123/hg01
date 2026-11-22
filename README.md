# AI HG01｜粗大動作溝通輔助系統（M1–M5 零分指手勢網頁原型）

以 **Python Flask + 瀏覽器端 MediaPipe Hand Landmarker JS + Web Speech 語音朗讀** 實作的兩層式溝通輔助（AAC）原型，專為**零分指要求（Gross-Motor）**設計。

## 動作與群組對照

| 動作代號 | 粗大動作描述（零分指要求） | 第一層（選群組） | 第二層（選短語／確認） |
| :--- | :--- | :--- | :--- |
| **M1 (Left)** | 整手向左平移或左側區域停留 | 群組 **G1**（生理需求） | 預選「向左選項」 |
| **M2 (Up)** | 整手向上抬升或上方區域停留 | 群組 **G2**（醫療不適） | 預選「向上選項」 |
| **M3 (Right)** | 整手向右平移或右側區域停留 | 群組 **G3**（日常回應） | 預選「向右選項」 |
| **M4 (Down)** | 整手向下放置或下方區域停留 | 群組 **G4**（環境協助） | 預選「向下選項」 |
| **M5 (Open ↔ Fist)** | 原地由握拳變為張掌（或半張掌駐留） | 群組 **G5**（緊急快捷） | **確認送出並朗讀**（無預選時返回主選單） |

## 啟動方式

### 方式 A：直接部署到 GitHub Pages（免後端、手機與電腦直接開網頁玩）
本專案已支援**純前端靜態模式**，直接將整個資料夾推送到 GitHub Repository 後：
1. 打開 GitHub Repo 的 **Settings → Pages**。
2. **Source** 選擇 **Deploy from a branch**，Branch 選 `main`、資料夾選 **`/ (root)`**，點 **Save**。
3. 等待約 1 分鐘即可打開 `https://<你的帳號>.github.io/<倉庫名稱>/` 直接遊玩：
   - 支援 **📷 攝影機 MediaPipe 即時辨識**（GitHub Pages 自帶 HTTPS，手機與電腦皆可開鏡頭）
   - 支援 **🖱️ 模擬測試** 與 **🔊 繁體中文語音朗讀**
   - 自訂的 G1–G5 詞庫、手勢門檻與溝通紀錄會自動存於瀏覽器 `localStorage`

### 方式 B：本機啟動 Flask 後端模式
```powershell
python app.py
```

開啟瀏覽器前往：`http://127.0.0.1:5000`（自動偵測 Flask 並同步儲存設定與紀錄至 `data/`）。

## 功能特色

- **雙模式操作**：
  - **📷 攝影機辨識**：瀏覽器本地執行 MediaPipe 手部關鍵點偵測，僅計算**掌心質心位置**與**整體手掌展開度比例**，不依賴單指辨識。
  - **🖱️ 模擬測試**：無攝影機時，可透過互動畫布游標、展開度滑桿、快捷按鈕或鍵盤（`WASD` / 方向鍵、`Space` / `Enter`、`Esc`）完整測試所有狀態與門檻。
- **即時個人化校準**：一鍵「校正中心」、即時展開度儀表板（顯示握拳／半張掌／張掌門檻），以及可自訂的停留時間與冷卻時間。
- **Flask 後端持久化**：
  - `GET / POST /api/config`、`POST /api/config/reset`：儲存自訂的 G1–G5 詞庫與手勢參數至 `data/config.json`。
  - `GET / POST / DELETE /api/events`：同步並管理語音送出紀錄至 `data/history.json`。

## 執行測試

```powershell
python -m pytest
node tests/test_gesture_engine.mjs
```
