/**
 * Browser-side MediaPipe HandLandmarker controller + HUD overlay renderer.
 * Loads @mediapipe/tasks-vision lazily when the user enables the camera.
 */

import { extractPalmFeatures } from "./gestureEngine.js";

const MEDIAPIPE_ESM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const MEDIAPIPE_WASM_ROOT =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const HAND_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

const ZONE_COLORS = {
  left: "rgba(56, 189, 248, 0.24)",
  up: "rgba(251, 113, 133, 0.24)",
  right: "rgba(52, 211, 153, 0.24)",
  down: "rgba(251, 191, 36, 0.24)",
  center: "rgba(167, 139, 250, 0.18)",
};

const ZONE_ACCENT = {
  left: "#38bdf8",
  up: "#fb7185",
  right: "#34d399",
  down: "#fbbf24",
  center: "#a78bfa",
};

/**
 * Draw the directional zones, deadzone circle, palm reticle, and optional landmarks
 * onto the given canvas. Used by both live webcam mode and virtual simulator mode.
 */
export function drawSensorOverlay(ctx, width, height, state, settings, landmarks = null, mirror = true) {
  const cx = (state?.center?.x ?? 0.5) * width;
  const cy = (state?.center?.y ?? 0.5) * height;
  const minDim = Math.min(width, height);
  const deadzonePx = (settings?.deadzoneRadius ?? 0.14) * minDim;

  // 1. Highlight active directional quadrant wedge
  const activeZone = state?.handPresent ? state.zone : "none";
  if (activeZone && activeZone !== "none" && activeZone !== "center") {
    ctx.save();
    ctx.fillStyle = ZONE_COLORS[activeZone] || "rgba(56, 189, 248, 0.2)";
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    const maxR = Math.hypot(width, height);
    const angles = {
      right: [-Math.PI / 4, Math.PI / 4],
      down: [Math.PI / 4, (3 * Math.PI) / 4],
      left: [(3 * Math.PI) / 4, (5 * Math.PI) / 4],
      up: [(-3 * Math.PI) / 4, -Math.PI / 4],
    }[activeZone];
    ctx.arc(cx, cy, maxR, angles[0], angles[1]);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // 2. Diagonal quadrant dividers outside the neutral deadzone
  ctx.save();
  ctx.strokeStyle = "rgba(148, 163, 184, 0.35)";
  ctx.lineWidth = 1.25;
  ctx.setLineDash([6, 6]);
  const diagLen = Math.hypot(width, height);
  for (const angle of [Math.PI / 4, (3 * Math.PI) / 4, (-3 * Math.PI) / 4, -Math.PI / 4]) {
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * deadzonePx, cy + Math.sin(angle) * deadzonePx);
    ctx.lineTo(cx + Math.cos(angle) * diagLen, cy + Math.sin(angle) * diagLen);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // 3. Center neutral deadzone circle (M5 hub)
  ctx.beginPath();
  ctx.arc(cx, cy, deadzonePx, 0, Math.PI * 2);
  ctx.fillStyle =
    activeZone === "center" ? ZONE_COLORS.center : "rgba(15, 23, 42, 0.42)";
  ctx.fill();
  ctx.lineWidth = activeZone === "center" ? 2.5 : 1.75;
  ctx.strokeStyle =
    activeZone === "center"
      ? state?.fistArmed
        ? "#f472b6"
        : "#a78bfa"
      : "rgba(148, 163, 184, 0.55)";
  ctx.stroke();

  // Center crosshair
  ctx.strokeStyle = "rgba(226, 232, 240, 0.4)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - 7, cy);
  ctx.lineTo(cx + 7, cy);
  ctx.moveTo(cx, cy - 7);
  ctx.lineTo(cx, cy + 7);
  ctx.stroke();

  // Zone edge labels
  ctx.font = "600 12px 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(226, 232, 240, 0.78)";
  ctx.fillText("M2 上", cx, Math.max(16, cy - deadzonePx - 24));
  ctx.fillText("M4 下", cx, Math.min(height - 16, cy + deadzonePx + 24));
  ctx.fillText("M1 左", Math.max(30, cx - deadzonePx - 36), cy);
  ctx.fillText("M3 右", Math.min(width - 30, cx + deadzonePx + 36), cy);
  ctx.fillStyle = "rgba(196, 181, 253, 0.9)";
  ctx.font = "600 11px 'Segoe UI', system-ui, sans-serif";
  ctx.fillText(state?.fistArmed ? "張掌送出" : "M5 區", cx, cy + deadzonePx - 14);
  ctx.restore();

  // 4. Optional MediaPipe hand landmarks
  if (landmarks && landmarks.length >= 21) {
    ctx.save();
    const toPt = (lm) => ({
      x: (mirror ? 1 - lm.x : lm.x) * width,
      y: lm.y * height,
    });

    ctx.strokeStyle = "rgba(148, 163, 184, 0.55)";
    ctx.lineWidth = 1.6;
    for (const [a, b] of HAND_CONNECTIONS) {
      const pa = toPt(landmarks[a]);
      const pb = toPt(landmarks[b]);
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }

    // Highlight palm polygon (0, 5, 9, 13, 17)
    ctx.fillStyle = "rgba(56, 189, 248, 0.16)";
    ctx.strokeStyle = "rgba(56, 189, 248, 0.75)";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    [0, 5, 9, 13, 17].forEach((idx, i) => {
      const p = toPt(landmarks[idx]);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Fingertip markers
    for (const tipIdx of [4, 8, 12, 16, 20]) {
      const p = toPt(landmarks[tipIdx]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fillStyle =
        state?.posture === "open"
          ? "#34d399"
          : state?.posture === "fist"
            ? "#fb7185"
            : "#e2e8f0";
      ctx.fill();
    }
    ctx.restore();
  }

  // 5. Smoothed Palm Center reticle + live dwell arc
  if (state?.handPresent && state.palm) {
    const px = state.palm.x * width;
    const py = state.palm.y * height;
    const accent = ZONE_ACCENT[state.zone] || "#38bdf8";

    ctx.save();
    // Connection line from center to palm
    ctx.strokeStyle = "rgba(226, 232, 240, 0.35)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(px, py);
    ctx.stroke();

    // Openness halo (size reflects coarse hand expansion)
    const haloRadius = Math.max(12, Math.min(34, (state.openness || 1) * 17));
    ctx.beginPath();
    ctx.arc(px, py, haloRadius, 0, Math.PI * 2);
    ctx.fillStyle =
      state.posture === "fist"
        ? "rgba(251, 113, 133, 0.25)"
        : state.posture === "open"
          ? "rgba(52, 211, 153, 0.25)"
          : "rgba(56, 189, 248, 0.22)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = accent;
    ctx.stroke();

    // Dwell / M5 / Cooldown progress arc
    const progress =
      state.dwellProgress > 0
        ? state.dwellProgress
        : state.m5Progress > 0
          ? state.m5Progress
          : 0;
    if (progress > 0) {
      ctx.beginPath();
      ctx.arc(
        px,
        py,
        haloRadius + 7,
        -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * progress
      );
      ctx.strokeStyle = state.m5Progress > 0 ? "#c084fc" : accent;
      ctx.lineWidth = 4.5;
      ctx.lineCap = "round";
      ctx.stroke();
    } else if (state.cooldownProgress > 0) {
      ctx.beginPath();
      ctx.arc(
        px,
        py,
        haloRadius + 6,
        -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * state.cooldownProgress
      );
      ctx.strokeStyle = "rgba(148, 163, 184, 0.65)";
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // Core palm dot
    ctx.beginPath();
    ctx.arc(px, py, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#f8fafc";
    ctx.fill();
    ctx.restore();
  }
}

export class CameraHandTracker {
  constructor({ videoEl, canvasEl, onFrame, onStatus }) {
    this.videoEl = videoEl;
    this.canvasEl = canvasEl;
    this.ctx = canvasEl.getContext("2d");
    this.onFrame = onFrame;
    this.onStatus = onStatus;

    this.handLandmarker = null;
    this.stream = null;
    this.running = false;
    this.rafId = null;
    this.lastVideoTime = -1;
    this.mirror = true;
    this.fpsCounter = { frames: 0, lastReset: performance.now(), fps: 0 };
  }

  setMirror(mirror) {
    this.mirror = Boolean(mirror);
  }

  async _ensureModelLoaded() {
    if (this.handLandmarker) return;
    this.onStatus?.("loading", "正在載入 MediaPipe 手部辨識模型...");

    const visionPkg = await import(/* @vite-ignore */ MEDIAPIPE_ESM_URL);
    const { FilesetResolver, HandLandmarker } = visionPkg;
    const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_ROOT);

    const commonOpts = {
      baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO",
      numHands: 1,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    };

    try {
      this.handLandmarker = await HandLandmarker.createFromOptions(vision, commonOpts);
    } catch {
      // Fallback cleanly to CPU delegate if WebGL/GPU delegate is unavailable
      this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
        ...commonOpts,
        baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate: "CPU" },
      });
    }
  }

  async start() {
    if (this.running) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.onStatus?.("error", "此瀏覽器不支援攝影機存取，請改用模擬模式。");
      return;
    }

    try {
      await this._ensureModelLoaded();
      this.onStatus?.("loading", "正在請求攝影機權限...");

      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });

      this.videoEl.srcObject = this.stream;
      await this.videoEl.play();

      this.canvasEl.width = this.videoEl.videoWidth || 640;
      this.canvasEl.height = this.videoEl.videoHeight || 480;
      this.running = true;
      this.lastVideoTime = -1;
      this.onStatus?.("running", "攝影機辨識中（零分指模式）");
      this._loop();
    } catch (err) {
      this.stop();
      const message =
        err?.name === "NotAllowedError"
          ? "攝影機權限遭拒，請允許權限或切換至模擬模式。"
          : err?.name === "NotFoundError"
            ? "找不到攝影機裝置，已可改用模擬模式測試。"
            : `無法啟動攝影機或載入模型：${err?.message || err}`;
      this.onStatus?.("error", message);
    }
  }

  stop() {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
    if (this.videoEl) {
      this.videoEl.srcObject = null;
    }
    this.onStatus?.("idle", "攝影機已關閉");
  }

  _loop() {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(() => this._loop());

    const video = this.videoEl;
    if (!video || video.readyState < 2 || !this.handLandmarker) {
      return;
    }

    const nowMs = performance.now();
    let landmarks = null;
    if (video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = video.currentTime;
      const result = this.handLandmarker.detectForVideo(video, nowMs);
      if (result?.landmarks?.length > 0) {
        landmarks = result.landmarks[0];
      }
    }

    // Track FPS
    this.fpsCounter.frames += 1;
    if (nowMs - this.fpsCounter.lastReset >= 1000) {
      this.fpsCounter.fps = this.fpsCounter.frames;
      this.fpsCounter.frames = 0;
      this.fpsCounter.lastReset = nowMs;
    }

    const features = landmarks ? extractPalmFeatures(landmarks, this.mirror) : null;
    const renderPayload = this.onFrame?.({
      features,
      landmarks,
      nowMs,
      fps: this.fpsCounter.fps,
    });

    // Draw mirrored or normal camera frame
    const { width, height } = this.canvasEl;
    const ctx = this.ctx;
    ctx.save();
    ctx.clearRect(0, 0, width, height);
    if (this.mirror) {
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, width, height);
    ctx.restore();

    // Subtle dark vignette for crisp HUD contrast
    ctx.fillStyle = "rgba(2, 6, 23, 0.22)";
    ctx.fillRect(0, 0, width, height);

    if (renderPayload) {
      drawSensorOverlay(
        ctx,
        width,
        height,
        renderPayload.state,
        renderPayload.settings,
        landmarks,
        this.mirror
      );
    }
  }
}
