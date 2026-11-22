/**
 * Dual-mode storage adapter:
 * - Automatically uses Flask REST API (/api/*) when a Flask backend is reachable.
 * - Seamlessly falls back to browser localStorage on GitHub Pages or static hosting.
 */

import { cloneDefaultConfig, mergeConfigWithDefaults } from "./defaults.js";

const STORAGE_CONFIG_KEY = "ai_hg01_config_v1";
const STORAGE_HISTORY_KEY = "ai_hg01_history_v1";
const MAX_HISTORY_ITEMS = 100;

export class StorageAdapter {
  constructor() {
    this.backendMode = "local"; // "flask" | "local"
  }

  async detectBackend() {
    const proto = window.location.protocol;
    const host = window.location.hostname;

    // Immediately choose static localStorage mode on GitHub Pages or local file://
    if (proto === "file:" || host.endsWith(".github.io")) {
      this.backendMode = "local";
      return this.backendMode;
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1200);
      const res = await fetch("./api/health", {
        method: "GET",
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        if (data?.status === "ok") {
          this.backendMode = "flask";
          return this.backendMode;
        }
      }
    } catch {
      // Static server or offline -> local mode
    }

    this.backendMode = "local";
    return this.backendMode;
  }

  isFlaskMode() {
    return this.backendMode === "flask";
  }

  async loadConfig() {
    if (this.backendMode === "flask") {
      try {
        const res = await fetch("./api/config");
        if (res.ok) return await res.json();
      } catch {
        // Fallback cleanly to local
        this.backendMode = "local";
      }
    }
    return this._readLocalConfig();
  }

  async saveConfig(partialPayload) {
    if (this.backendMode === "flask") {
      const res = await fetch("./api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(partialPayload),
      });
      if (!res.ok) throw new Error("Flask config save failed");
      return await res.json();
    }

    const current = this._readLocalConfig();
    const merged = mergeConfigWithDefaults({
      groups: partialPayload.groups ?? current.groups,
      settings: partialPayload.settings
        ? { ...current.settings, ...partialPayload.settings }
        : current.settings,
    });
    this._writeLocal(STORAGE_CONFIG_KEY, merged);
    return merged;
  }

  async resetConfig() {
    if (this.backendMode === "flask") {
      const res = await fetch("./api/config/reset", { method: "POST" });
      if (!res.ok) throw new Error("Flask config reset failed");
      return await res.json();
    }

    const defaults = cloneDefaultConfig();
    this._writeLocal(STORAGE_CONFIG_KEY, defaults);
    return defaults;
  }

  async loadEvents() {
    if (this.backendMode === "flask") {
      try {
        const res = await fetch("./api/events");
        if (res.ok) {
          const data = await res.json();
          return Array.isArray(data.events) ? data.events : [];
        }
      } catch {
        this.backendMode = "local";
      }
    }
    return this._readLocalHistory();
  }

  async addEvent(payload) {
    if (this.backendMode === "flask") {
      const res = await fetch("./api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        return data.event;
      }
    }

    const event = {
      id: `evt_${Date.now()}`,
      timestamp: new Date().toISOString(),
      groupId: String(payload.groupId || "").slice(0, 8),
      groupTitle: String(payload.groupTitle || "").slice(0, 32),
      motion: String(payload.motion || "M5").slice(0, 16),
      direction: String(payload.direction || "").slice(0, 16),
      text: String(payload.text || "").slice(0, 120),
      source: String(payload.source || "camera").slice(0, 24),
      triggerDetail: String(payload.triggerDetail || "").slice(0, 40),
    };
    const history = this._readLocalHistory();
    history.unshift(event);
    this._writeLocal(STORAGE_HISTORY_KEY, history.slice(0, MAX_HISTORY_ITEMS));
    return event;
  }

  async clearEvents() {
    if (this.backendMode === "flask") {
      await fetch("./api/events", { method: "DELETE" });
      return;
    }
    this._writeLocal(STORAGE_HISTORY_KEY, []);
  }

  _readLocalConfig() {
    try {
      const raw = window.localStorage.getItem(STORAGE_CONFIG_KEY);
      if (!raw) return cloneDefaultConfig();
      return mergeConfigWithDefaults(JSON.parse(raw));
    } catch {
      return cloneDefaultConfig();
    }
  }

  _readLocalHistory() {
    try {
      const raw = window.localStorage.getItem(STORAGE_HISTORY_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  _writeLocal(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore storage quota or private-mode errors
    }
  }
}
