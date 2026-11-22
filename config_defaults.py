"""Default configuration for the M1-M5 gross-motor AAC web prototype."""

from copy import deepcopy

DEFAULT_GROUPS = {
    "G1": {
        "id": "G1",
        "motion": "M1",
        "direction": "left",
        "direction_label": "向左選項",
        "title": "生理需求",
        "icon": "💧",
        "color": "#38bdf8",
        "phrases": {
            "left": "我想喝水",
            "up": "我肚子餓了，想吃東西",
            "right": "我需要上廁所",
            "down": "請幫我調整姿勢",
        },
    },
    "G2": {
        "id": "G2",
        "motion": "M2",
        "direction": "up",
        "direction_label": "向上選項",
        "title": "醫療不適",
        "icon": "🩺",
        "color": "#fb7185",
        "phrases": {
            "left": "我身體不太舒服",
            "up": "這裡會痛，請幫我看一下",
            "right": "我有點頭暈想吐",
            "down": "請幫我叫護理師或照顧者",
        },
    },
    "G3": {
        "id": "G3",
        "motion": "M3",
        "direction": "right",
        "direction_label": "向右選項",
        "title": "日常回應",
        "icon": "💬",
        "color": "#34d399",
        "phrases": {
            "left": "是的，好的",
            "up": "不用，謝謝",
            "right": "謝謝你的幫忙",
            "down": "請稍等我一下",
        },
    },
    "G4": {
        "id": "G4",
        "motion": "M4",
        "direction": "down",
        "direction_label": "向下選項",
        "title": "環境協助",
        "icon": "💡",
        "color": "#fbbf24",
        "phrases": {
            "left": "有點冷，請幫我蓋被子",
            "up": "有點熱，請開風扇或冷氣",
            "right": "請幫我開燈或關燈",
            "down": "請幫我拿手機或眼鏡",
        },
    },
    "G5": {
        "id": "G5",
        "motion": "M5",
        "direction": "center",
        "direction_label": "確認送出 / 快捷",
        "title": "緊急快捷",
        "icon": "🔔",
        "color": "#a78bfa",
        "phrases": {
            "left": "我需要立即幫忙！",
            "up": "我呼吸有點困難，請立刻協助！",
            "right": "請幫我聯絡家人",
            "down": "我沒事了，謝謝關心",
        },
    },
}

DEFAULT_SETTINGS = {
    "directionMode": "hybrid",        # "dwell" | "hybrid" | "swipe"
    "m5Mode": "both",                 # "both" | "transition" | "dwell"
    "dwellMs": 800,                   # Directional zone dwell time (ms)
    "m5DwellMs": 1100,                # Half-open center dwell time (ms)
    "cooldownMs": 950,                # Cooldown after any trigger (ms)
    "deadzoneRadius": 0.14,           # Neutral center radius (normalized 0..0.5)
    "swipeDisplacement": 0.16,        # Gross swipe distance threshold
    "fistThreshold": 1.05,            # Openness below this counts as fist
    "halfOpenThreshold": 1.25,        # Openness above this counts as half-open
    "openThreshold": 1.42,            # Openness above this completes Fist->Open
    "smoothingAlpha": 0.35,           # EMA smoothing factor
    "mirrorCamera": True,             # Mirror webcam horizontally
    "speechEnabled": True,            # Auto TTS on M5 confirm
    "soundEffects": True,             # Gentle tactile feedback chimes
    "speechRate": 1.0,                # TTS speed (0.6..1.5)
    "autoReturnAfterSpeak": True,     # Return to Level 1 after confirming phrase
}


def get_default_config():
    """Return a fresh deep copy of the complete default configuration."""
    return {
        "groups": deepcopy(DEFAULT_GROUPS),
        "settings": deepcopy(DEFAULT_SETTINGS),
    }
