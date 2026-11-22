import {
  GrossMotorGestureEngine,
  MOTION_TO_DIRECTION,
} from "./gestureEngine.js";
import { CameraHandTracker, drawSensorOverlay } from "./cameraTracker.js";
import { SpeechAudioController } from "./speechAudio.js";
import { StorageAdapter } from "./storageAdapter.js";

const DIRECTION_LABELS = {
  left: "M1 向左選項",
  up: "M2 向上選項",
  right: "M3 向右選項",
  down: "M4 向下選項",
};

const ZONE_TEXT = {
  none: "未偵測到手",
  center: "中心區 (M5)",
  left: "左側區 (M1)",
  up: "上方區 (M2)",
  right: "右側區 (M3)",
  down: "下方區 (M4)",
};

const POSTURE_TEXT = {
  none: "待命",
  fist: "握拳 (Fist)",
  neutral: "中性微收",
  half_open: "半張掌",
  open: "張掌 (Open)",
};

const GROUP_BY_MOTION = {
  M1: "G1",
  M2: "G2",
  M3: "G3",
  M4: "G4",
  M5: "G5",
};

const RING_CIRCUMFERENCE = 2 * Math.PI * 54;

class AACApp {
  constructor() {
    this.config = null;
    this.history = [];

    // Menu state machine
    this.level = 1; // 1 = group selection, 2 = phrase selection
    this.activeGroupId = null;
    this.armedDirection = null;
    this.lastSpoken = null;

    // Input mode ("simulator" | "camera")
    this.inputMode = "simulator";
    this.simRafId = null;
    this.simHand = {
      x: 0.5,
      y: 0.5,
      openness: 1.12,
      pointerActive: false,
    };
    this.lastTelemetryState = null;

    this.engine = new GrossMotorGestureEngine();
    this.speech = new SpeechAudioController();
    this.storage = new StorageAdapter();
    this.tracker = null;
    this.toastTimer = null;

    this._cacheElements();
    this._bindEvents();
  }

  _cacheElements() {
    this.el = {
      appSubtitle: document.getElementById("appSubtitle"),
      historyHeading: document.getElementById("historyHeading"),
      phraseTabDesc: document.getElementById("phraseTabDesc"),
      btnModeCamera: document.getElementById("btnModeCamera"),
      btnModeSim: document.getElementById("btnModeSim"),
      btnToggleCamera: document.getElementById("btnToggleCamera"),
      btnStartCameraInline: document.getElementById("btnStartCameraInline"),
      btnCalibrate: document.getElementById("btnCalibrate"),
      btnResetCenter: document.getElementById("btnResetCenter"),
      btnToggleSpeech: document.getElementById("btnToggleSpeech"),
      btnOpenSettings: document.getElementById("btnOpenSettings"),
      btnBackLevel: document.getElementById("btnBackLevel"),

      stepBadge: document.getElementById("stepBadge"),
      stageTitle: document.getElementById("stageTitle"),
      outputBanner: document.getElementById("outputBanner"),
      outputStatusTag: document.getElementById("outputStatusTag"),
      outputHint: document.getElementById("outputHint"),
      outputText: document.getElementById("outputText"),
      btnConfirmArmed: document.getElementById("btnConfirmArmed"),
      btnCancelArmed: document.getElementById("btnCancelArmed"),
      btnReplayLast: document.getElementById("btnReplayLast"),

      cards: {
        left: document.getElementById("cardLeft"),
        up: document.getElementById("cardUp"),
        right: document.getElementById("cardRight"),
        down: document.getElementById("cardDown"),
        center: document.getElementById("cardCenter"),
      },
      dwellFills: {
        left: document.getElementById("dwellLeft"),
        up: document.getElementById("dwellUp"),
        right: document.getElementById("dwellRight"),
        down: document.getElementById("dwellDown"),
      },
      hubRingProgress: document.getElementById("hubRingProgress"),

      statusDot: document.getElementById("statusDot"),
      sensorStatusText: document.getElementById("sensorStatusText"),
      fpsBadge: document.getElementById("fpsBadge"),
      cameraVideo: document.getElementById("cameraVideo"),
      sensorCanvas: document.getElementById("sensorCanvas"),
      cameraPromptOverlay: document.getElementById("cameraPromptOverlay"),

      simControls: document.getElementById("simControls"),
      simOpennessSlider: document.getElementById("simOpennessSlider"),
      simOpennessVal: document.getElementById("simOpennessVal"),
      simPostureLabel: document.getElementById("simPostureLabel"),
      btnSimFistOpen: document.getElementById("btnSimFistOpen"),

      metricZone: document.getElementById("metricZone"),
      metricOffset: document.getElementById("metricOffset"),
      metricPosture: document.getElementById("metricPosture"),
      metricLastTrigger: document.getElementById("metricLastTrigger"),
      metricOpenness: document.getElementById("metricOpenness"),
      meterFill: document.getElementById("meterFill"),
      markerFist: document.getElementById("markerFist"),
      markerHalf: document.getElementById("markerHalf"),
      markerOpen: document.getElementById("markerOpen"),

      historyList: document.getElementById("historyList"),
      btnClearHistory: document.getElementById("btnClearHistory"),

      settingsModal: document.getElementById("settingsModal"),
      btnCloseModal: document.getElementById("btnCloseModal"),
      btnCancelSettings: document.getElementById("btnCancelSettings"),
      btnSaveSettings: document.getElementById("btnSaveSettings"),
      btnResetDefaults: document.getElementById("btnResetDefaults"),
      phraseEditorContainer: document.getElementById("phraseEditorContainer"),

      toast: document.getElementById("toast"),
    };
  }

  async init() {
    this.tracker = new CameraHandTracker({
      videoEl: this.el.cameraVideo,
      canvasEl: this.el.sensorCanvas,
      onFrame: ({ features, nowMs, fps }) => this._onCameraFrame(features, nowMs, fps),
      onStatus: (state, msg) => this._onCameraStatus(state, msg),
    });

    await this.storage.detectBackend();
    this._updateStorageModeLabels();
    await Promise.all([this.loadConfig(), this.loadHistory()]);
    this.setInputMode("simulator");
    this.renderStage();
  }

  _updateStorageModeLabels() {
    const isFlask = this.storage.isFlaskMode();
    if (this.el.appSubtitle) {
      this.el.appSubtitle.textContent = isFlask
        ? "M1–M5 零分指手勢選單 · Flask 後端 + MediaPipe 即時原型"
        : "M1–M5 零分指手勢選單 · 純前端靜態模式（適用 GitHub Pages）";
    }
    if (this.el.historyHeading) {
      this.el.historyHeading.textContent = isFlask
        ? "溝通紀錄（已同步至 Flask）"
        : "溝通紀錄（已存於本機瀏覽器）";
    }
    if (this.el.phraseTabDesc) {
      this.el.phraseTabDesc.textContent = isFlask
        ? "自訂每個群組（G1–G5）的名稱與 4 個方向（M1 左 / M2 上 / M3 右 / M4 下）對應的語音短語，儲存後會永久保留在 Flask 後端。"
        : "自訂每個群組（G1–G5）的名稱與 4 個方向（M1 左 / M2 上 / M3 右 / M4 下）對應的語音短語，儲存後會保留在此瀏覽器的 localStorage。";
    }
  }

  async loadConfig() {
    try {
      this.config = await this.storage.loadConfig();
    } catch {
      this.showToast("讀取設定失敗，已使用預設詞庫。");
      return;
    }
    this._applySettings(this.config.settings);
    this.renderStage();
  }

  async loadHistory() {
    try {
      this.history = await this.storage.loadEvents();
      this.renderHistory();
    } catch {
      // Ignore transient history load failure
    }
  }

  _applySettings(settings) {
    if (!settings) return;
    this.engine.updateSettings(settings);
    this.speech.configure(settings);
    this.tracker?.setMirror(settings.mirrorCamera);
    this._updateSpeechToggleBtn();
    this._updateOpennessMarkers();
  }

  _updateSpeechToggleBtn() {
    const on = Boolean(this.config?.settings?.speechEnabled);
    this.el.btnToggleSpeech.textContent = on ? "🔊 語音：開" : "🔇 語音：關";
  }

  _updateOpennessMarkers() {
    const s = this.config?.settings;
    if (!s) return;
    const toPct = (v) => `${Math.max(0, Math.min(100, ((v - 0.4) / 1.6) * 100))}%`;
    this.el.markerFist.style.left = toPct(s.fistThreshold);
    this.el.markerHalf.style.left = toPct(s.halfOpenThreshold);
    this.el.markerOpen.style.left = toPct(s.openThreshold);
  }

  _bindEvents() {
    // Mode switcher
    this.el.btnModeCamera.addEventListener("click", () => this.setInputMode("camera"));
    this.el.btnModeSim.addEventListener("click", () => this.setInputMode("simulator"));

    // Camera start/stop
    this.el.btnToggleCamera.addEventListener("click", () => this.toggleCamera());
    this.el.btnStartCameraInline.addEventListener("click", () => this.toggleCamera());

    // Calibrate & reset center
    this.el.btnCalibrate.addEventListener("click", () => {
      const center = this.engine.calibrateCenter();
      if (center) {
        this.showToast(`已校正中心點 (${center.x.toFixed(2)}, ${center.y.toFixed(2)})`);
      } else {
        this.showToast("尚未偵測到手部，請將手放入畫面後再校正。");
      }
    });

    this.el.btnResetCenter.addEventListener("click", () => {
      this.engine.resetCenter();
      this.showToast("已將中心點重設至畫面中央 (0.50, 0.50)");
    });

    // Quick speech toggle
    this.el.btnToggleSpeech.addEventListener("click", async () => {
      if (!this.config) return;
      const next = !this.config.settings.speechEnabled;
      this.config.settings.speechEnabled = next;
      this._applySettings(this.config.settings);
      this.showToast(next ? "已開啟確認送出語音朗讀" : "已關閉語音朗讀");
      try {
        await this.storage.saveConfig({ settings: { speechEnabled: next } });
      } catch {
        // Non-fatal
      }
    });

    // Stage buttons
    this.el.btnBackLevel.addEventListener("click", () => this.goBackToLevel1());
    this.el.btnConfirmArmed.addEventListener("click", () =>
      this.handleMotionTrigger("M5", "click", "按鈕確認")
    );
    this.el.btnCancelArmed.addEventListener("click", () => {
      this.armedDirection = null;
      this.speech.playTone("back");
      this.renderStage();
    });
    this.el.btnReplayLast.addEventListener("click", () => {
      if (this.lastSpoken?.text) {
        this.speech.speak(this.lastSpoken.text);
        this.showToast(`重播語音：${this.lastSpoken.text}`);
      }
    });

    // Direct clicks on the 5 cross-stage cards
    Object.values(this.el.cards).forEach((card) => {
      card.addEventListener("click", () => {
        const motion = card.dataset.motion;
        if (motion) {
          this.handleMotionTrigger(motion, "click", "直接點擊");
        }
      });
    });

    // Simulator pointer tracking on canvas
    const canvas = this.el.sensorCanvas;
    const updateSimPointer = (evt) => {
      if (this.inputMode !== "simulator") return;
      const rect = canvas.getBoundingClientRect();
      const x = (evt.clientX - rect.left) / rect.width;
      const y = (evt.clientY - rect.top) / rect.height;
      this.simHand.x = Math.max(0.02, Math.min(0.98, x));
      this.simHand.y = Math.max(0.02, Math.min(0.98, y));
      this.simHand.pointerActive = true;
    };

    canvas.addEventListener("pointermove", updateSimPointer);
    canvas.addEventListener("pointerdown", updateSimPointer);
    canvas.addEventListener("pointerleave", () => {
      if (this.inputMode !== "simulator") return;
      this.simHand.x = this.engine.center.x;
      this.simHand.y = this.engine.center.y;
      this.simHand.pointerActive = false;
    });

    // Simulator openness slider
    this.el.simOpennessSlider.addEventListener("input", (e) => {
      const val = parseFloat(e.target.value);
      this.simHand.openness = val;
      this.el.simOpennessVal.textContent = val.toFixed(2);
    });

    // Simulator quick M1-M4 triggers
    document.querySelectorAll("[data-sim-trigger]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const motion = btn.dataset.simTrigger;
        this.handleMotionTrigger(motion, "simulator", "模擬按鈕");
      });
    });

    // Simulator Fist -> Open M5 pulse button
    this.el.btnSimFistOpen.addEventListener("click", () => {
      this._triggerSimulatedFistToOpen();
    });

    // Keyboard shortcuts (ignored when typing in inputs or modal open)
    window.addEventListener("keydown", (e) => {
      if (!this.el.settingsModal.classList.contains("hidden")) {
        if (e.key === "Escape") this.closeSettingsModal();
        return;
      }
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const map = {
        ArrowLeft: "M1",
        a: "M1",
        A: "M1",
        ArrowUp: "M2",
        w: "M2",
        W: "M2",
        ArrowRight: "M3",
        d: "M3",
        D: "M3",
        ArrowDown: "M4",
        s: "M4",
        S: "M4",
        " ": "M5",
        Enter: "M5",
      };
      if (e.key === "Escape") {
        e.preventDefault();
        if (this.armedDirection) {
          this.armedDirection = null;
          this.speech.playTone("back");
          this.renderStage();
        } else if (this.level === 2) {
          this.goBackToLevel1();
        }
        return;
      }
      const motion = map[e.key];
      if (motion) {
        e.preventDefault();
        this.handleMotionTrigger(motion, "keyboard", "鍵盤模擬");
      }
    });

    // History clear
    this.el.btnClearHistory.addEventListener("click", async () => {
      try {
        await this.storage.clearEvents();
        this.history = [];
        this.renderHistory();
        this.showToast("已清空溝通紀錄");
      } catch {
        this.showToast("清空失敗，請稍後再試");
      }
    });

    // Settings Modal
    this.el.btnOpenSettings.addEventListener("click", () => this.openSettingsModal());
    this.el.btnCloseModal.addEventListener("click", () => this.closeSettingsModal());
    this.el.btnCancelSettings.addEventListener("click", () => this.closeSettingsModal());
    this.el.settingsModal.addEventListener("click", (e) => {
      if (e.target === this.el.settingsModal) this.closeSettingsModal();
    });

    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = btn.dataset.tab;
        document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
        document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
        btn.classList.add("active");
        document
          .getElementById(target === "phrases" ? "tabPhrases" : "tabTuning")
          .classList.add("active");
      });
    });

    this.el.btnSaveSettings.addEventListener("click", () => this.saveSettingsFromModal());
    this.el.btnResetDefaults.addEventListener("click", () => this.resetDefaults());

    // Live slider label bindings in modal
    const sliderLabels = [
      ["cfgDwellMs", "valDwellMs", (v) => `${v} ms`],
      ["cfgM5DwellMs", "valM5DwellMs", (v) => `${v} ms`],
      ["cfgCooldownMs", "valCooldownMs", (v) => `${v} ms`],
      ["cfgDeadzone", "valDeadzone", (v) => Number(v).toFixed(2)],
      ["cfgFistThreshold", "valFistThreshold", (v) => Number(v).toFixed(2)],
      ["cfgHalfOpenThreshold", "valHalfOpenThreshold", (v) => Number(v).toFixed(2)],
      ["cfgOpenThreshold", "valOpenThreshold", (v) => Number(v).toFixed(2)],
      ["cfgSpeechRate", "valSpeechRate", (v) => `${Number(v).toFixed(1)}x`],
    ];
    for (const [inputId, labelId, fmt] of sliderLabels) {
      const input = document.getElementById(inputId);
      const label = document.getElementById(labelId);
      input.addEventListener("input", () => {
        label.textContent = fmt(input.value);
      });
    }
  }

  setInputMode(mode) {
    this.inputMode = mode;
    const isCamera = mode === "camera";

    this.el.btnModeCamera.classList.toggle("active", isCamera);
    this.el.btnModeSim.classList.toggle("active", !isCamera);
    this.el.btnToggleCamera.classList.toggle("hidden", !isCamera);
    this.el.simControls.classList.toggle("hidden", isCamera);

    this.engine.resetRuntimeState();

    if (isCamera) {
      this._stopSimLoop();
      this.el.cameraPromptOverlay.classList.toggle("hidden", Boolean(this.tracker?.running));
      if (!this.tracker?.running) {
        this._setStatus("loading", "攝影機待命：請點擊「啟動攝影機」", "CAM");
      }
    } else {
      if (this.tracker?.running) {
        this.tracker.stop();
        this.el.btnToggleCamera.textContent = "啟動攝影機";
      }
      this.el.cameraPromptOverlay.classList.add("hidden");
      this._setStatus("sim", "模擬模式就緒（移動畫布游標或鍵盤）", "SIM");
      this._startSimLoop();
    }
  }

  async toggleCamera() {
    if (!this.tracker) return;
    if (this.tracker.running) {
      this.tracker.stop();
      this.el.btnToggleCamera.textContent = "啟動攝影機";
      this.el.cameraPromptOverlay.classList.remove("hidden");
      return;
    }

    this.el.cameraPromptOverlay.classList.add("hidden");
    this.el.btnToggleCamera.textContent = "載入中...";
    this.el.btnToggleCamera.disabled = true;
    await this.tracker.start();
    this.el.btnToggleCamera.disabled = false;
    this.el.btnToggleCamera.textContent = this.tracker.running ? "停止攝影機" : "啟動攝影機";
    if (!this.tracker.running) {
      this.el.cameraPromptOverlay.classList.remove("hidden");
    }
  }

  _onCameraStatus(status, message) {
    if (status === "running") {
      this._setStatus("live", message, "-- FPS");
    } else if (status === "loading") {
      this._setStatus("loading", message, "LOAD");
    } else if (status === "error") {
      this._setStatus("error", message, "ERR");
      this.showToast(message);
    } else {
      if (this.inputMode === "camera") {
        this._setStatus("loading", message, "OFF");
      }
    }
  }

  _setStatus(kind, text, badge) {
    this.el.statusDot.className = "status-dot";
    if (kind === "live") this.el.statusDot.classList.add("dot-live");
    else if (kind === "sim") this.el.statusDot.classList.add("dot-sim");
    else if (kind === "error") this.el.statusDot.classList.add("dot-error");
    else this.el.statusDot.classList.add("dot-loading");

    this.el.sensorStatusText.textContent = text;
    if (badge !== undefined) {
      this.el.fpsBadge.textContent = badge;
    }
  }

  _onCameraFrame(features, nowMs, fps) {
    const state = this.engine.update(features, nowMs);
    this._updateLiveFeedback(state, "camera");
    if (fps > 0) {
      this.el.fpsBadge.textContent = `${fps} FPS`;
    }
    return {
      state,
      settings: this.config?.settings,
    };
  }

  _startSimLoop() {
    this._stopSimLoop();
    const canvas = this.el.sensorCanvas;
    canvas.width = 480;
    canvas.height = 360;
    const ctx = canvas.getContext("2d");

    const tick = () => {
      if (this.inputMode !== "simulator") return;
      this.simRafId = requestAnimationFrame(tick);

      const nowMs = performance.now();
      const state = this.engine.update(
        {
          x: this.simHand.x,
          y: this.simHand.y,
          openness: this.simHand.openness,
        },
        nowMs
      );
      this._updateLiveFeedback(state, "simulator");

      // Background grid for virtual radar
      ctx.fillStyle = "#080f1f";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.strokeStyle = "rgba(148, 163, 184, 0.08)";
      ctx.lineWidth = 1;
      for (let gx = 40; gx < canvas.width; gx += 40) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, canvas.height);
        ctx.stroke();
      }
      for (let gy = 40; gy < canvas.height; gy += 40) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(canvas.width, gy);
        ctx.stroke();
      }

      drawSensorOverlay(
        ctx,
        canvas.width,
        canvas.height,
        state,
        this.config?.settings,
        null,
        false
      );
    };

    this.simRafId = requestAnimationFrame(tick);
  }

  _stopSimLoop() {
    if (this.simRafId) {
      cancelAnimationFrame(this.simRafId);
      this.simRafId = null;
    }
  }

  _triggerSimulatedFistToOpen() {
    if (this.inputMode === "simulator") {
      // Animate a realistic Fist -> Open transition right through the gesture engine
      this.simHand.x = this.engine.center.x;
      this.simHand.y = this.engine.center.y;
      const fistVal = Math.max(0.7, (this.config?.settings?.fistThreshold ?? 1.05) - 0.2);
      const openVal = Math.min(1.75, (this.config?.settings?.openThreshold ?? 1.42) + 0.18);

      this.simHand.openness = fistVal;
      this.el.simOpennessSlider.value = String(fistVal);
      this.el.simOpennessVal.textContent = fistVal.toFixed(2);

      setTimeout(() => {
        this.simHand.openness = openVal;
        this.el.simOpennessSlider.value = String(openVal);
        this.el.simOpennessVal.textContent = openVal.toFixed(2);

        setTimeout(() => {
          this.simHand.openness = 1.12;
          this.el.simOpennessSlider.value = "1.12";
          this.el.simOpennessVal.textContent = "1.12";
        }, 320);
      }, 180);
    } else {
      this.handleMotionTrigger("M5", "simulator", "握拳→張掌模擬");
    }
  }

  _updateLiveFeedback(state, source) {
    this.lastTelemetryState = state;

    // 1. Update telemetry readouts
    this.el.metricZone.textContent = ZONE_TEXT[state.zone] || "—";
    this.el.metricOffset.textContent = state.handPresent
      ? `${state.dx >= 0 ? "+" : ""}${state.dx.toFixed(2)}, ${state.dy >= 0 ? "+" : ""}${state.dy.toFixed(2)}`
      : "—";
    this.el.metricPosture.textContent = state.fistArmed
      ? "握拳就緒 → 請張掌"
      : POSTURE_TEXT[state.posture] || "待命";
    this.el.metricOpenness.textContent = state.handPresent
      ? state.openness.toFixed(2)
      : "0.00";

    if (this.inputMode === "simulator") {
      this.el.simPostureLabel.textContent = POSTURE_TEXT[state.posture] || "中性";
    }

    const opennessPct = state.handPresent
      ? Math.max(0, Math.min(100, ((state.openness - 0.4) / 1.6) * 100))
      : 0;
    this.el.meterFill.style.width = `${opennessPct}%`;

    // 2. Highlight active directional card & update dwell progress bars
    for (const dir of ["left", "up", "right", "down"]) {
      const card = this.el.cards[dir];
      const fill = this.el.dwellFills[dir];
      const active = state.handPresent && state.zone === dir;
      card.classList.toggle("zone-active", active);
      const pct = state.dwellDirection === dir ? Math.round(state.dwellProgress * 100) : 0;
      fill.style.width = `${pct}%`;
    }

    // 3. Center M5 hub live ring & fist-armed pulse
    const centerCard = this.el.cards.center;
    centerCard.classList.toggle("zone-active", state.handPresent && state.zone === "center");
    centerCard.classList.toggle("fist-armed", Boolean(state.fistArmed));
    const offset = RING_CIRCUMFERENCE * (1 - (state.m5Progress || 0));
    this.el.hubRingProgress.style.strokeDashoffset = String(offset);

    // 4. Handle triggered gesture event
    if (state.triggered) {
      this.handleMotionTrigger(
        state.triggered.motion,
        source,
        state.triggered.triggerDetail
      );
    }
  }

  handleMotionTrigger(motion, source = "camera", triggerDetail = "") {
    if (!this.config) return;

    this.el.metricLastTrigger.textContent = triggerDetail
      ? `${motion} (${triggerDetail})`
      : motion;

    // Flash matching card and legend badge
    const dir = MOTION_TO_DIRECTION[motion];
    const card = this.el.cards[dir];
    if (card) {
      card.classList.remove("flash-triggered");
      void card.offsetWidth;
      card.classList.add("flash-triggered");
    }
    document.querySelectorAll(".legend-item").forEach((item) => {
      item.classList.toggle("active", item.dataset.legend === motion);
    });

    if (this.level === 1) {
      const groupId = GROUP_BY_MOTION[motion];
      if (!groupId || !this.config.groups[groupId]) return;
      this.level = 2;
      this.activeGroupId = groupId;
      this.armedDirection = null;
      this.speech.playTone("select");
      this.renderStage();
      return;
    }

    // Level 2: Inside an active group
    if (motion === "M5") {
      if (this.armedDirection) {
        this._confirmAndSpeakArmedPhrase(source, triggerDetail);
      } else {
        this.goBackToLevel1();
      }
      return;
    }

    // Level 2: M1-M4 selects or toggles pre-selected phrase
    if (dir && dir !== "center") {
      if (this.armedDirection === dir) {
        this.armedDirection = null;
        this.speech.playTone("back");
      } else {
        this.armedDirection = dir;
        this.speech.playTone("select");
      }
      this.renderStage();
    }
  }

  async _confirmAndSpeakArmedPhrase(source, triggerDetail) {
    const group = this.config?.groups?.[this.activeGroupId];
    if (!group || !this.armedDirection) return;
    const text = group.phrases[this.armedDirection];
    if (!text) return;

    this.speech.playTone("confirm");
    this.speech.speak(text);

    const payload = {
      groupId: group.id,
      groupTitle: group.title,
      motion: `${group.motion}→M5`,
      direction: this.armedDirection,
      text,
      source,
      triggerDetail: triggerDetail || "確認送出",
    };

    this.lastSpoken = payload;

    // Persist to Flask backend or browser localStorage
    try {
      const savedEvent = await this.storage.addEvent(payload);
      if (savedEvent) {
        this.history.unshift(savedEvent);
        this.renderHistory();
      }
    } catch {
      // Still keep local UI responsive even if logging fails
    }

    if (this.config.settings.autoReturnAfterSpeak) {
      this.level = 1;
      this.activeGroupId = null;
      this.armedDirection = null;
    } else {
      this.armedDirection = null;
    }

    this.renderStage();
    this.showToast(`已確認送出：「${text}」`);
  }

  goBackToLevel1() {
    this.level = 1;
    this.activeGroupId = null;
    this.armedDirection = null;
    this.speech.playTone("back");
    this.renderStage();
  }

  renderStage() {
    if (!this.config) return;
    const groups = this.config.groups;

    if (this.level === 1) {
      this.el.stepBadge.textContent = "步驟 1 / 2";
      this.el.stageTitle.textContent = "選擇溝通群組 (G1–G5)";
      this.el.btnBackLevel.classList.add("hidden");

      const dirToGroup = { left: "G1", up: "G2", right: "G3", down: "G4" };
      for (const [dir, gid] of Object.entries(dirToGroup)) {
        const g = groups[gid];
        const cap = dir.charAt(0).toUpperCase() + dir.slice(1);
        document.getElementById(`code${cap}`).textContent = g.id;
        document.getElementById(`icon${cap}`).textContent = g.icon;
        document.getElementById(`title${cap}`).textContent = g.title;
        document.getElementById(`sub${cap}`).innerHTML = Object.values(g.phrases)
          .map((p) => `<span>${this._escapeHtml(p)}</span>`)
          .join("");
        this.el.cards[dir].classList.remove("is-armed");
      }

      // Center hub = G5
      const g5 = groups.G5;
      document.getElementById("iconCenter").textContent = g5.icon;
      document.getElementById("titleCenter").textContent = `${g5.id} ${g5.title}`;
      document.getElementById("subCenter").textContent = "握拳→張掌 或 半張掌駐留進入";
      this.el.cards.center.classList.remove("confirm-ready");
    } else {
      const activeGroup = groups[this.activeGroupId];
      this.el.stepBadge.textContent = `步驟 2 / 2 · ${activeGroup.id}`;
      this.el.stageTitle.textContent = `${activeGroup.icon} ${activeGroup.title} — 選擇短語並以 M5 確認送出`;
      this.el.btnBackLevel.classList.remove("hidden");

      for (const dir of ["left", "up", "right", "down"]) {
        const cap = dir.charAt(0).toUpperCase() + dir.slice(1);
        const isArmed = this.armedDirection === dir;
        document.getElementById(`code${cap}`).textContent = isArmed ? "已預選" : activeGroup.id;
        document.getElementById(`icon${cap}`).textContent = isArmed ? "✅" : activeGroup.icon;
        document.getElementById(`title${cap}`).textContent = activeGroup.phrases[dir];
        document.getElementById(`sub${cap}`).innerHTML = isArmed
          ? "<span>再選一次取消預選</span>"
          : `<span>${DIRECTION_LABELS[dir]}</span>`;
        this.el.cards[dir].classList.toggle("is-armed", isArmed);
      }

      if (this.armedDirection) {
        const phrase = activeGroup.phrases[this.armedDirection];
        document.getElementById("iconCenter").textContent = "📣";
        document.getElementById("titleCenter").textContent = "確認送出並朗讀";
        document.getElementById("subCenter").textContent = `「${phrase}」`;
        this.el.cards.center.classList.add("confirm-ready");
      } else {
        document.getElementById("iconCenter").textContent = "↩️";
        document.getElementById("titleCenter").textContent = "返回主選單";
        document.getElementById("subCenter").textContent = "尚未預選短語，做 M5 返回 G1–G5";
        this.el.cards.center.classList.remove("confirm-ready");
      }
    }

    this._renderOutputBanner();
  }

  _renderOutputBanner() {
    const banner = this.el.outputBanner;
    banner.classList.remove("state-idle", "state-armed", "state-spoken");
    this.el.btnConfirmArmed.classList.add("hidden");
    this.el.btnCancelArmed.classList.add("hidden");
    this.el.btnReplayLast.classList.add("hidden");

    if (this.level === 2 && this.armedDirection) {
      const group = this.config.groups[this.activeGroupId];
      const phrase = group.phrases[this.armedDirection];
      banner.classList.add("state-armed");
      this.el.outputStatusTag.textContent = "已預選・等待 M5 確認";
      this.el.outputHint.textContent = "原地握拳變為張掌（或半張掌駐留）即可立即送出語音";
      this.el.outputText.textContent = phrase;
      this.el.btnConfirmArmed.classList.remove("hidden");
      this.el.btnCancelArmed.classList.remove("hidden");
      return;
    }

    if (this.lastSpoken) {
      banner.classList.add("state-spoken");
      this.el.outputStatusTag.textContent = `已送出 · ${this.lastSpoken.groupId} ${this.lastSpoken.groupTitle}`;
      this.el.outputHint.textContent = `觸發方式：${this.lastSpoken.triggerDetail}（${this.lastSpoken.motion}）`;
      this.el.outputText.textContent = this.lastSpoken.text;
      this.el.btnReplayLast.classList.remove("hidden");
      return;
    }

    banner.classList.add("state-idle");
    this.el.outputStatusTag.textContent = this.level === 1 ? "步驟 1：選群組" : "步驟 2：選短語";
    this.el.outputHint.textContent =
      this.level === 1
        ? "整手向四方向平移或區域停留進入 G1–G4，原地 M5 進入 G5 緊急快捷"
        : "向四方向選擇一句短語，再做 M5 確認送出並朗讀";
    this.el.outputText.textContent =
      this.level === 1 ? "請以粗大動作選擇群組 (G1–G5)" : "請選擇一個方向的短語";
  }

  renderHistory() {
    const list = this.el.historyList;
    if (!this.history || this.history.length === 0) {
      list.innerHTML =
        '<li class="history-empty">尚無送出紀錄，完成一次 M5 確認後會顯示於此。</li>';
      return;
    }

    list.innerHTML = "";
    for (const item of this.history.slice(0, 30)) {
      const li = document.createElement("li");
      li.className = "history-item";

      const timeStr = item.timestamp
        ? new Date(item.timestamp).toLocaleTimeString("zh-TW", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })
        : "";

      const left = document.createElement("div");
      left.innerHTML = `
        <div class="history-text">${this._escapeHtml(item.text)}</div>
        <div class="history-meta">${this._escapeHtml(timeStr)} · ${this._escapeHtml(
          item.groupId || ""
        )} ${this._escapeHtml(item.groupTitle || "")} · ${this._escapeHtml(
          item.triggerDetail || item.motion || ""
        )}</div>
      `;

      const replayBtn = document.createElement("button");
      replayBtn.type = "button";
      replayBtn.className = "btn btn-sm btn-secondary";
      replayBtn.textContent = "🔊";
      replayBtn.title = "重播這句語音";
      replayBtn.addEventListener("click", () => {
        this.speech.speak(item.text);
      });

      li.appendChild(left);
      li.appendChild(replayBtn);
      list.appendChild(li);
    }
  }

  openSettingsModal() {
    if (!this.config) return;

    // Populate G1-G5 phrase editor
    const container = this.el.phraseEditorContainer;
    container.innerHTML = "";
    for (const gid of ["G1", "G2", "G3", "G4", "G5"]) {
      const g = this.config.groups[gid];
      const card = document.createElement("div");
      card.className = "group-edit-card";
      card.innerHTML = `
        <div class="group-edit-header">
          <span>${this._escapeHtml(g.icon)}</span>
          <span>${g.id}（${g.motion}）</span>
        </div>
        <label>
          群組名稱
          <input type="text" data-group="${gid}" data-field="title" value="${this._escapeAttr(
            g.title
          )}" maxlength="24" />
        </label>
        <label>
          M1 向左選項
          <input type="text" data-group="${gid}" data-dir="left" value="${this._escapeAttr(
            g.phrases.left
          )}" maxlength="80" />
        </label>
        <label>
          M2 向上選項
          <input type="text" data-group="${gid}" data-dir="up" value="${this._escapeAttr(
            g.phrases.up
          )}" maxlength="80" />
        </label>
        <label>
          M3 向右選項
          <input type="text" data-group="${gid}" data-dir="right" value="${this._escapeAttr(
            g.phrases.right
          )}" maxlength="80" />
        </label>
        <label>
          M4 向下選項
          <input type="text" data-group="${gid}" data-dir="down" value="${this._escapeAttr(
            g.phrases.down
          )}" maxlength="80" />
        </label>
      `;
      container.appendChild(card);
    }

    // Populate tuning controls
    const s = this.config.settings;
    document.getElementById("cfgDirectionMode").value = s.directionMode;
    document.getElementById("cfgM5Mode").value = s.m5Mode;
    document.getElementById("cfgDwellMs").value = s.dwellMs;
    document.getElementById("valDwellMs").textContent = `${s.dwellMs} ms`;
    document.getElementById("cfgM5DwellMs").value = s.m5DwellMs;
    document.getElementById("valM5DwellMs").textContent = `${s.m5DwellMs} ms`;
    document.getElementById("cfgCooldownMs").value = s.cooldownMs;
    document.getElementById("valCooldownMs").textContent = `${s.cooldownMs} ms`;
    document.getElementById("cfgDeadzone").value = s.deadzoneRadius;
    document.getElementById("valDeadzone").textContent = Number(s.deadzoneRadius).toFixed(2);
    document.getElementById("cfgFistThreshold").value = s.fistThreshold;
    document.getElementById("valFistThreshold").textContent = Number(s.fistThreshold).toFixed(2);
    document.getElementById("cfgHalfOpenThreshold").value = s.halfOpenThreshold;
    document.getElementById("valHalfOpenThreshold").textContent = Number(
      s.halfOpenThreshold
    ).toFixed(2);
    document.getElementById("cfgOpenThreshold").value = s.openThreshold;
    document.getElementById("valOpenThreshold").textContent = Number(s.openThreshold).toFixed(2);
    document.getElementById("cfgSpeechRate").value = s.speechRate;
    document.getElementById("valSpeechRate").textContent = `${Number(s.speechRate).toFixed(1)}x`;

    document.getElementById("cfgMirrorCamera").checked = Boolean(s.mirrorCamera);
    document.getElementById("cfgSpeechEnabled").checked = Boolean(s.speechEnabled);
    document.getElementById("cfgSoundEffects").checked = Boolean(s.soundEffects);
    document.getElementById("cfgAutoReturn").checked = Boolean(s.autoReturnAfterSpeak);

    this.el.settingsModal.classList.remove("hidden");
  }

  closeSettingsModal() {
    this.el.settingsModal.classList.add("hidden");
  }

  async saveSettingsFromModal() {
    const updatedGroups = structuredClone(this.config.groups);
    this.el.phraseEditorContainer.querySelectorAll("input[data-group]").forEach((input) => {
      const gid = input.dataset.group;
      const val = input.value.trim();
      if (!val) return;
      if (input.dataset.field === "title") {
        updatedGroups[gid].title = val;
      } else if (input.dataset.dir) {
        updatedGroups[gid].phrases[input.dataset.dir] = val;
      }
    });

    const updatedSettings = {
      directionMode: document.getElementById("cfgDirectionMode").value,
      m5Mode: document.getElementById("cfgM5Mode").value,
      dwellMs: Number(document.getElementById("cfgDwellMs").value),
      m5DwellMs: Number(document.getElementById("cfgM5DwellMs").value),
      cooldownMs: Number(document.getElementById("cfgCooldownMs").value),
      deadzoneRadius: Number(document.getElementById("cfgDeadzone").value),
      fistThreshold: Number(document.getElementById("cfgFistThreshold").value),
      halfOpenThreshold: Number(document.getElementById("cfgHalfOpenThreshold").value),
      openThreshold: Number(document.getElementById("cfgOpenThreshold").value),
      speechRate: Number(document.getElementById("cfgSpeechRate").value),
      mirrorCamera: document.getElementById("cfgMirrorCamera").checked,
      speechEnabled: document.getElementById("cfgSpeechEnabled").checked,
      soundEffects: document.getElementById("cfgSoundEffects").checked,
      autoReturnAfterSpeak: document.getElementById("cfgAutoReturn").checked,
    };

    try {
      this.config = await this.storage.saveConfig({
        groups: updatedGroups,
        settings: updatedSettings,
      });
      this._applySettings(this.config.settings);
      this.renderStage();
      this.closeSettingsModal();
      this.showToast("已儲存詞庫與手勢參數設定");
    } catch {
      this.showToast("儲存失敗，請稍後再試");
    }
  }

  async resetDefaults() {
    try {
      this.config = await this.storage.resetConfig();
      this._applySettings(this.config.settings);
      this.renderStage();
      this.closeSettingsModal();
      this.showToast("已恢復預設 G1–G5 詞庫與手勢參數");
    } catch {
      this.showToast("恢復預設失敗");
    }
  }

  showToast(message) {
    this.el.toast.textContent = message;
    this.el.toast.classList.remove("hidden");
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.el.toast.classList.add("hidden");
    }, 2800);
  }

  _escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  _escapeAttr(str) {
    return this._escapeHtml(str);
  }
}

const app = new AACApp();
app.init();
