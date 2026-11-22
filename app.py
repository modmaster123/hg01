"""Flask web server for the M1-M5 gross-motor AAC communication prototype."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, request, send_from_directory

from config_defaults import DEFAULT_GROUPS, DEFAULT_SETTINGS, get_default_config

VALID_GROUP_IDS = ("G1", "G2", "G3", "G4", "G5")
VALID_DIRECTIONS = ("left", "up", "right", "down")
VALID_DIRECTION_MODES = {"dwell", "hybrid", "swipe"}
VALID_M5_MODES = {"both", "transition", "dwell"}
MAX_HISTORY_ITEMS = 100


def _merge_config(raw: dict[str, Any] | None) -> dict[str, Any]:
    """Merge persisted user config onto defaults while guarding schema integrity."""
    merged = get_default_config()
    if not isinstance(raw, dict):
        return merged

    raw_groups = raw.get("groups")
    if isinstance(raw_groups, dict):
        for gid in VALID_GROUP_IDS:
            user_group = raw_groups.get(gid)
            if not isinstance(user_group, dict):
                continue
            target = merged["groups"][gid]
            if isinstance(user_group.get("title"), str) and user_group["title"].strip():
                target["title"] = user_group["title"].strip()[:24]
            if isinstance(user_group.get("icon"), str) and user_group["icon"].strip():
                target["icon"] = user_group["icon"].strip()[:8]
            raw_phrases = user_group.get("phrases")
            if isinstance(raw_phrases, dict):
                for direction in VALID_DIRECTIONS:
                    val = raw_phrases.get(direction)
                    if isinstance(val, str) and val.strip():
                        target["phrases"][direction] = val.strip()[:80]

    raw_settings = raw.get("settings")
    if isinstance(raw_settings, dict):
        settings = merged["settings"]
        if raw_settings.get("directionMode") in VALID_DIRECTION_MODES:
            settings["directionMode"] = raw_settings["directionMode"]
        if raw_settings.get("m5Mode") in VALID_M5_MODES:
            settings["m5Mode"] = raw_settings["m5Mode"]

        numeric_bounds = {
            "dwellMs": (250, 3000, int),
            "m5DwellMs": (400, 3500, int),
            "cooldownMs": (300, 3000, int),
            "deadzoneRadius": (0.05, 0.32, float),
            "swipeDisplacement": (0.08, 0.35, float),
            "fistThreshold": (0.55, 1.45, float),
            "halfOpenThreshold": (0.75, 1.75, float),
            "openThreshold": (0.95, 2.00, float),
            "smoothingAlpha": (0.10, 0.85, float),
            "speechRate": (0.5, 1.8, float),
        }
        for key, (low, high, caster) in numeric_bounds.items():
            if key in raw_settings:
                try:
                    value = caster(raw_settings[key])
                except (TypeError, ValueError):
                    continue
                settings[key] = max(low, min(high, value))

        for bool_key in (
            "mirrorCamera",
            "speechEnabled",
            "soundEffects",
            "autoReturnAfterSpeak",
        ):
            if isinstance(raw_settings.get(bool_key), bool):
                settings[bool_key] = raw_settings[bool_key]

    return merged


def create_app(data_dir: Path | str | None = None) -> Flask:
    """Create and configure the Flask application."""
    app = Flask(__name__)
    base_dir = Path(__file__).resolve().parent
    storage_dir = Path(data_dir) if data_dir is not None else base_dir / "data"
    storage_dir.mkdir(parents=True, exist_ok=True)

    config_path = storage_dir / "config.json"
    history_path = storage_dir / "history.json"

    def load_config() -> dict[str, Any]:
        if not config_path.exists():
            return get_default_config()
        try:
            data = json.loads(config_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return get_default_config()
        return _merge_config(data)

    def save_config(cfg: dict[str, Any]) -> dict[str, Any]:
        sanitized = _merge_config(cfg)
        config_path.write_text(
            json.dumps(sanitized, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return sanitized

    def load_history() -> list[dict[str, Any]]:
        if not history_path.exists():
            return []
        try:
            data = json.loads(history_path.read_text(encoding="utf-8"))
            return data if isinstance(data, list) else []
        except (OSError, json.JSONDecodeError):
            return []

    def save_history(items: list[dict[str, Any]]) -> None:
        history_path.write_text(
            json.dumps(items[:MAX_HISTORY_ITEMS], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    @app.route("/")
    def index():
        return send_from_directory(base_dir, "index.html")

    @app.route("/api/health", methods=["GET"])
    def health():
        return jsonify({"status": "ok", "service": "ai-hg01-aac-web"})

    @app.route("/api/config", methods=["GET"])
    def get_config():
        return jsonify(load_config())

    @app.route("/api/config", methods=["POST"])
    def update_config():
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return jsonify({"error": "Invalid JSON body"}), 400
        current = load_config()
        if "groups" in payload:
            current["groups"] = payload["groups"]
        if "settings" in payload:
            current["settings"] = {**current["settings"], **payload["settings"]}
        saved = save_config(current)
        return jsonify(saved)

    @app.route("/api/config/reset", methods=["POST"])
    def reset_config():
        defaults = get_default_config()
        saved = save_config(defaults)
        return jsonify(saved)

    @app.route("/api/events", methods=["GET"])
    def get_events():
        return jsonify({"events": load_history()})

    @app.route("/api/events", methods=["POST"])
    def add_event():
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return jsonify({"error": "Invalid JSON body"}), 400

        text = str(payload.get("text", "")).strip()
        if not text:
            return jsonify({"error": "Event text is required"}), 400

        event = {
            "id": f"evt_{int(datetime.now(timezone.utc).timestamp() * 1000)}",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "groupId": str(payload.get("groupId", ""))[:8],
            "groupTitle": str(payload.get("groupTitle", ""))[:32],
            "motion": str(payload.get("motion", "M5"))[:16],
            "direction": str(payload.get("direction", ""))[:16],
            "text": text[:120],
            "source": str(payload.get("source", "camera"))[:24],
            "triggerDetail": str(payload.get("triggerDetail", ""))[:40],
        }

        history = load_history()
        history.insert(0, event)
        save_history(history)
        return jsonify({"event": event, "total": len(history[:MAX_HISTORY_ITEMS])}), 201

    @app.route("/api/events", methods=["DELETE"])
    def clear_events():
        save_history([])
        return jsonify({"cleared": True})

    return app


app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    app.run(host="127.0.0.1", port=port, debug=False)
