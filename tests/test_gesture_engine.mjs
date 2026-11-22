import assert from "node:assert/strict";
import {
  GrossMotorGestureEngine,
  extractPalmFeatures,
} from "../static/js/gestureEngine.js";

function makeSyntheticLandmarks({ cx = 0.5, cy = 0.5, scale = 0.1, tipRadius = 0.15 }) {
  const pts = Array.from({ length: 21 }, () => ({ x: cx, y: cy, z: 0 }));
  // Palm landmarks: 0 (wrist), 5, 9, 13, 17
  pts[0] = { x: cx, y: cy + scale * 0.6, z: 0 };
  pts[9] = { x: cx, y: cy - scale * 0.4, z: 0 };
  pts[5] = { x: cx - scale * 0.5, y: cy - scale * 0.2, z: 0 };
  pts[13] = { x: cx + scale * 0.15, y: cy - scale * 0.25, z: 0 };
  pts[17] = { x: cx + scale * 0.5, y: cy - scale * 0.2, z: 0 };

  // Fingertips arranged radially around palm center
  const tipAngles = [-2.4, -1.9, -1.57, -1.2, -0.8];
  const tipIndices = [4, 8, 12, 16, 20];
  tipIndices.forEach((idx, i) => {
    pts[idx] = {
      x: cx + Math.cos(tipAngles[i]) * tipRadius,
      y: cy + Math.sin(tipAngles[i]) * tipRadius,
      z: 0,
    };
  });
  return pts;
}

// 1. Palm feature extraction (fist vs open)
const fistFeatures = extractPalmFeatures(makeSyntheticLandmarks({ tipRadius: 0.06 }), true);
const openFeatures = extractPalmFeatures(makeSyntheticLandmarks({ tipRadius: 0.17 }), true);
assert.ok(fistFeatures.openness < 1.0, `Expected fist openness < 1.0, got ${fistFeatures.openness}`);
assert.ok(openFeatures.openness > 1.4, `Expected open openness > 1.4, got ${openFeatures.openness}`);

// 2. M1 Left dwell trigger
{
  const engine = new GrossMotorGestureEngine({
    directionMode: "dwell",
    dwellMs: 500,
    cooldownMs: 600,
    smoothingAlpha: 1.0,
  });
  let fired = null;
  for (let t = 0; t <= 600; t += 100) {
    const res = engine.update({ x: 0.2, y: 0.5, openness: 1.1 }, t);
    if (res.triggered) fired = res.triggered;
  }
  assert.ok(fired, "Expected M1 dwell to fire");
  assert.equal(fired.motion, "M1");
  assert.equal(fired.direction, "left");
  assert.equal(fired.triggerDetail, "區域停留");
}

// 3. M2 Up gross swipe trigger
{
  const engine = new GrossMotorGestureEngine({
    directionMode: "swipe",
    swipeDisplacement: 0.15,
    smoothingAlpha: 1.0,
  });
  let fired = null;
  const ys = [0.5, 0.45, 0.39, 0.32, 0.24];
  ys.forEach((y, i) => {
    const res = engine.update({ x: 0.5, y, openness: 1.1 }, i * 40);
    if (res.triggered) fired = res.triggered;
  });
  assert.ok(fired, "Expected M2 swipe to fire");
  assert.equal(fired.motion, "M2");
  assert.equal(fired.direction, "up");
  assert.equal(fired.triggerDetail, "整手平移");
}

// 4. M5 Fist -> Open transition trigger
{
  const engine = new GrossMotorGestureEngine({
    m5Mode: "transition",
    fistThreshold: 1.05,
    openThreshold: 1.4,
    smoothingAlpha: 1.0,
  });
  const s1 = engine.update({ x: 0.5, y: 0.5, openness: 0.85 }, 100);
  assert.equal(s1.fistArmed, true);
  assert.equal(s1.triggered, null);

  const s2 = engine.update({ x: 0.5, y: 0.5, openness: 1.55 }, 300);
  assert.ok(s2.triggered, "Expected M5 Fist->Open to fire");
  assert.equal(s2.triggered.motion, "M5");
  assert.equal(s2.triggered.triggerDetail, "握拳→張掌");
}

// 5. M5 Half-open dwell trigger + anti-repeat reset guard
{
  const engine = new GrossMotorGestureEngine({
    m5Mode: "dwell",
    m5DwellMs: 600,
    cooldownMs: 300,
    halfOpenThreshold: 1.25,
    smoothingAlpha: 1.0,
  });
  let triggerCount = 0;
  for (let t = 0; t <= 1600; t += 100) {
    const res = engine.update({ x: 0.5, y: 0.5, openness: 1.32 }, t);
    if (res.triggered) triggerCount += 1;
  }
  assert.equal(triggerCount, 1, "Half-open dwell must fire once and wait for reset");
}

// 6. Calibration shifts deadzone center
{
  const engine = new GrossMotorGestureEngine({ smoothingAlpha: 1.0 });
  engine.update({ x: 0.35, y: 0.65, openness: 1.1 }, 100);
  const c = engine.calibrateCenter();
  assert.deepEqual(c, { x: 0.35, y: 0.65 });
  const after = engine.update({ x: 0.36, y: 0.65, openness: 1.1 }, 150);
  assert.equal(after.zone, "center");
}

console.log("All 6 gestureEngine tests passed!");
