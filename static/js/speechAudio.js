/**
 * Traditional Chinese (zh-TW) Web Speech synthesis + gentle Web Audio feedback chimes.
 */

export class SpeechAudioController {
  constructor() {
    this.audioCtx = null;
    this.enabled = true;
    this.soundEffects = true;
    this.rate = 1.0;
    this.preferredVoice = null;

    if ("speechSynthesis" in window) {
      this._loadVoices();
      window.speechSynthesis.addEventListener("voiceschanged", () => this._loadVoices());
    }
  }

  configure({ speechEnabled, soundEffects, speechRate }) {
    if (typeof speechEnabled === "boolean") this.enabled = speechEnabled;
    if (typeof soundEffects === "boolean") this.soundEffects = soundEffects;
    if (typeof speechRate === "number") this.rate = speechRate;
  }

  _loadVoices() {
    const voices = window.speechSynthesis.getVoices();
    if (!voices || voices.length === 0) return;

    // Prefer zh-TW / Traditional Chinese voices, then generic zh
    this.preferredVoice =
      voices.find((v) => /zh[-_]TW/i.test(v.lang)) ||
      voices.find((v) => /Hanhan|Yating|Zhiwei|Meijia/i.test(v.name)) ||
      voices.find((v) => /zh[-_]HK/i.test(v.lang)) ||
      voices.find((v) => /^zh/i.test(v.lang)) ||
      null;
  }

  speak(text) {
    if (!this.enabled || !text || !("speechSynthesis" in window)) {
      return false;
    }
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = "zh-TW";
      utter.rate = Math.max(0.5, Math.min(1.8, this.rate || 1.0));
      utter.pitch = 1.0;
      if (this.preferredVoice) {
        utter.voice = this.preferredVoice;
      }
      window.speechSynthesis.speak(utter);
      return true;
    } catch {
      return false;
    }
  }

  _ensureAudioContext() {
    if (!this.soundEffects) return null;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.audioCtx) {
      this.audioCtx = new AudioCtx();
    }
    if (this.audioCtx.state === "suspended") {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  playTone(kind = "select") {
    const ctx = this._ensureAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes =
      kind === "confirm"
        ? [
            { freq: 523.25, start: 0, dur: 0.11, gain: 0.12 },
            { freq: 659.25, start: 0.09, dur: 0.14, gain: 0.14 },
          ]
        : kind === "back"
          ? [
              { freq: 440, start: 0, dur: 0.08, gain: 0.09 },
              { freq: 349.23, start: 0.07, dur: 0.11, gain: 0.09 },
            ]
          : [{ freq: 587.33, start: 0, dur: 0.09, gain: 0.1 }];

    for (const n of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(n.freq, now + n.start);
      gain.gain.setValueAtTime(0.001, now + n.start);
      gain.gain.exponentialRampToValueAtTime(n.gain, now + n.start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, now + n.start + n.dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + n.start);
      osc.stop(now + n.start + n.dur + 0.02);
    }
  }
}
