/**
 * Gross-motor (zero fine-finger individuation) gesture recognition engine.
 *
 * Implements the M1-M5 mapping:
 *  - M1 (Left):  whole-hand translate left or dwell in left zone
 *  - M2 (Up):    whole-hand lift up or dwell in upper zone
 *  - M3 (Right): whole-hand translate right or dwell in right zone
 *  - M4 (Down):  whole-hand lower down or dwell in lower zone
 *  - M5 (Open <-> Fist): stationary Fist -> Open transition, or half-open palm dwell
 */

const PALM_INDICES = [0, 5, 9, 13, 17];
const FINGERTIP_INDICES = [4, 8, 12, 16, 20];

export const MOTION_TO_DIRECTION = {
  M1: "left",
  M2: "up",
  M3: "right",
  M4: "down",
  M5: "center",
};

export const DIRECTION_TO_MOTION = {
  left: "M1",
  up: "M2",
  right: "M3",
  down: "M4",
  center: "M5",
};

function dist2D(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Extract palm-only center and whole-hand openness ratio from 21 MediaPipe landmarks.
 * Does not depend on any individual finger identity.
 */
export function extractPalmFeatures(landmarks, mirror = true) {
  if (!Array.isArray(landmarks) || landmarks.length < 21) {
    return null;
  }

  let cx = 0;
  let cy = 0;
  for (const idx of PALM_INDICES) {
    cx += landmarks[idx].x;
    cy += landmarks[idx].y;
  }
  cx /= PALM_INDICES.length;
  cy /= PALM_INDICES.length;

  const palmLength = dist2D(landmarks[0], landmarks[9]);
  const palmWidth = dist2D(landmarks[5], landmarks[17]);
  const palmScale = Math.max(0.03, (palmLength + palmWidth) / 2);

  const palmPoint = { x: cx, y: cy };
  let tipDistSum = 0;
  for (const idx of FINGERTIP_INDICES) {
    tipDistSum += dist2D(landmarks[idx], palmPoint);
  }
  const openness = tipDistSum / FINGERTIP_INDICES.length / palmScale;

  return {
    x: mirror ? 1 - cx : cx,
    y: cy,
    openness,
    palmScale,
  };
}

export class GrossMotorGestureEngine {
  constructor(settings = {}) {
    this.settings = {
      directionMode: "hybrid",
      m5Mode: "both",
      dwellMs: 800,
      m5DwellMs: 1100,
      cooldownMs: 950,
      deadzoneRadius: 0.14,
      swipeDisplacement: 0.16,
      fistThreshold: 1.05,
      halfOpenThreshold: 1.25,
      openThreshold: 1.42,
      smoothingAlpha: 0.35,
      ...settings,
    };

    this.center = { x: 0.5, y: 0.5 };
    this.resetRuntimeState();
  }

  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
  }

  resetRuntimeState() {
    this.smoothed = null;
    this.lastSeenMs = 0;
    this.trail = [];
    this.activeZone = "center";
    this.zoneEnteredMs = 0;
    this.cooldownUntilMs = 0;
    this.fistArmedUntilMs = 0;
    this.m5DwellStartMs = 0;
    this.m5DwellRequiresReset = false;
  }

  calibrateCenter() {
    if (this.smoothed) {
      this.center = {
        x: Math.min(0.8, Math.max(0.2, this.smoothed.x)),
        y: Math.min(0.8, Math.max(0.2, this.smoothed.y)),
      };
      this.activeZone = "center";
      this.zoneEnteredMs = 0;
      this.trail = [];
      return { ...this.center };
    }
    return null;
  }

  resetCenter() {
    this.center = { x: 0.5, y: 0.5 };
    this.activeZone = "center";
    this.zoneEnteredMs = 0;
    this.trail = [];
    return { ...this.center };
  }

  /**
   * Process one frame of hand features ({ x, y, openness } or null when no hand).
   * Returns a rich state snapshot plus an optional `triggered` event.
   */
  update(sample, nowMs = performance.now()) {
    if (!sample) {
      if (nowMs - this.lastSeenMs > 450) {
        this.smoothed = null;
        this.trail = [];
        this.activeZone = "center";
        this.zoneEnteredMs = 0;
        this.m5DwellStartMs = 0;
        this.m5DwellRequiresReset = false;
        this.fistArmedUntilMs = 0;
      }
      return {
        handPresent: false,
        palm: null,
        center: { ...this.center },
        dx: 0,
        dy: 0,
        distance: 0,
        openness: 0,
        posture: "none",
        zone: "none",
        dwellDirection: null,
        dwellProgress: 0,
        m5Progress: 0,
        fistArmed: false,
        m5NeedsReset: false,
        cooldownProgress: this._cooldownProgress(nowMs),
        triggered: null,
      };
    }

    const alpha = this.settings.smoothingAlpha;
    if (!this.smoothed || nowMs - this.lastSeenMs > 450) {
      this.smoothed = {
        x: sample.x,
        y: sample.y,
        openness: sample.openness,
      };
      this.trail = [];
    } else {
      this.smoothed = {
        x: this.smoothed.x + alpha * (sample.x - this.smoothed.x),
        y: this.smoothed.y + alpha * (sample.y - this.smoothed.y),
        openness: this.smoothed.openness + alpha * (sample.openness - this.smoothed.openness),
      };
    }
    this.lastSeenMs = nowMs;

    const { x, y, openness } = this.smoothed;
    this.trail.push({ t: nowMs, x, y });
    while (this.trail.length > 0 && nowMs - this.trail[0].t > 420) {
      this.trail.shift();
    }

    const dx = x - this.center.x;
    const dy = y - this.center.y;
    const distance = Math.hypot(dx, dy);
    const deadzone = this.settings.deadzoneRadius;

    // Classify current zone
    let zone = "center";
    if (distance > deadzone) {
      if (Math.abs(dx) >= Math.abs(dy)) {
        zone = dx < 0 ? "left" : "right";
      } else {
        zone = dy < 0 ? "up" : "down";
      }
    }

    // Classify coarse palm openness state
    let posture = "neutral";
    if (openness <= this.settings.fistThreshold) {
      posture = "fist";
    } else if (openness >= this.settings.openThreshold) {
      posture = "open";
    } else if (openness >= this.settings.halfOpenThreshold) {
      posture = "half_open";
    }

    // Clear M5 dwell reset guard once the hand relaxes/closes or leaves center
    if (
      this.m5DwellRequiresReset &&
      (zone !== "center" || openness < this.settings.halfOpenThreshold - 0.08)
    ) {
      this.m5DwellRequiresReset = false;
    }

    const inCooldown = nowMs < this.cooldownUntilMs;
    let triggered = null;
    let dwellDirection = null;
    let dwellProgress = 0;
    let m5Progress = 0;

    if (inCooldown) {
      this.zoneEnteredMs = 0;
      this.m5DwellStartMs = 0;
    } else {
      // 1. Check M5 (Open <-> Fist or Half-Open Dwell) when hand is near center
      const nearCenter = distance <= deadzone * 1.35;
      const speed = this._recentSpeed();

      if (nearCenter) {
        if (openness <= this.settings.fistThreshold) {
          this.fistArmedUntilMs = nowMs + 2400;
        }

        const allowTransition =
          this.settings.m5Mode === "both" || this.settings.m5Mode === "transition";
        const allowHalfOpenDwell =
          this.settings.m5Mode === "both" || this.settings.m5Mode === "dwell";

        if (
          allowTransition &&
          this.fistArmedUntilMs > nowMs &&
          openness >= this.settings.openThreshold
        ) {
          triggered = this._fire("M5", "center", "握拳→張掌", nowMs);
          this.fistArmedUntilMs = 0;
        } else if (
          allowHalfOpenDwell &&
          !this.m5DwellRequiresReset &&
          distance <= deadzone * 1.15 &&
          openness >= this.settings.halfOpenThreshold &&
          speed < 0.45
        ) {
          if (!this.m5DwellStartMs) {
            this.m5DwellStartMs = nowMs;
          }
          m5Progress = Math.min(1, (nowMs - this.m5DwellStartMs) / this.settings.m5DwellMs);
          if (m5Progress >= 1) {
            triggered = this._fire("M5", "center", "半張掌駐留", nowMs);
            this.m5DwellRequiresReset = true;
          }
        } else {
          this.m5DwellStartMs = 0;
        }
      } else {
        this.m5DwellStartMs = 0;
      }

      // 2. Check M1-M4 (Whole-hand swipe or directional zone dwell)
      if (!triggered) {
        const allowSwipe =
          this.settings.directionMode === "swipe" || this.settings.directionMode === "hybrid";
        const allowDwell =
          this.settings.directionMode === "dwell" || this.settings.directionMode === "hybrid";

        if (allowSwipe && zone !== "center") {
          const swipeDir = this._detectGrossSwipe(zone);
          if (swipeDir) {
            triggered = this._fire(
              DIRECTION_TO_MOTION[swipeDir],
              swipeDir,
              "整手平移",
              nowMs
            );
          }
        }

        if (!triggered && allowDwell && zone !== "center") {
          if (this.activeZone !== zone || !this.zoneEnteredMs) {
            this.activeZone = zone;
            this.zoneEnteredMs = nowMs;
          }
          dwellDirection = zone;
          dwellProgress = Math.min(1, (nowMs - this.zoneEnteredMs) / this.settings.dwellMs);
          if (dwellProgress >= 1) {
            triggered = this._fire(
              DIRECTION_TO_MOTION[zone],
              zone,
              "區域停留",
              nowMs
            );
          }
        } else if (zone === "center") {
          this.activeZone = "center";
          this.zoneEnteredMs = 0;
        }
      }
    }

    return {
      handPresent: true,
      palm: { x, y },
      center: { ...this.center },
      dx,
      dy,
      distance,
      openness,
      posture,
      zone,
      dwellDirection,
      dwellProgress,
      m5Progress,
      fistArmed: this.fistArmedUntilMs > nowMs,
      m5NeedsReset: this.m5DwellRequiresReset,
      cooldownProgress: this._cooldownProgress(nowMs),
      triggered,
    };
  }

  _fire(motion, direction, triggerDetail, nowMs) {
    this.cooldownUntilMs = nowMs + this.settings.cooldownMs;
    this.zoneEnteredMs = 0;
    this.m5DwellStartMs = 0;
    this.trail = [];
    return {
      motion,
      direction,
      triggerDetail,
      timestampMs: nowMs,
    };
  }

  _cooldownProgress(nowMs) {
    if (nowMs >= this.cooldownUntilMs) {
      return 0;
    }
    return Math.min(1, (this.cooldownUntilMs - nowMs) / Math.max(1, this.settings.cooldownMs));
  }

  _recentSpeed() {
    if (this.trail.length < 2) {
      return 0;
    }
    const latest = this.trail[this.trail.length - 1];
    let prev = this.trail[0];
    for (let i = this.trail.length - 2; i >= 0; i--) {
      if (latest.t - this.trail[i].t >= 120) {
        prev = this.trail[i];
        break;
      }
    }
    const dt = (latest.t - prev.t) / 1000;
    if (dt <= 0.02) {
      return 0;
    }
    return Math.hypot(latest.x - prev.x, latest.y - prev.y) / dt;
  }

  _detectGrossSwipe(currentZone) {
    if (this.trail.length < 4) {
      return null;
    }
    const latest = this.trail[this.trail.length - 1];
    const start = this.trail[0];
    const dt = (latest.t - start.t) / 1000;
    if (dt < 0.09 || dt > 0.45) {
      return null;
    }

    const vx = latest.x - start.x;
    const vy = latest.y - start.y;
    const absX = Math.abs(vx);
    const absY = Math.abs(vy);
    const threshold = this.settings.swipeDisplacement;

    if (Math.max(absX, absY) < threshold) {
      return null;
    }

    // Require clear single-axis dominance and brisk motion
    const speed = Math.hypot(vx, vy) / dt;
    if (speed < 0.42) {
      return null;
    }

    let swipeDir = null;
    if (absX > absY * 1.45) {
      swipeDir = vx < 0 ? "left" : "right";
    } else if (absY > absX * 1.45) {
      swipeDir = vy < 0 ? "up" : "down";
    }

    // Must match the zone the hand actually moved into
    return swipeDir === currentZone ? swipeDir : null;
  }
}
