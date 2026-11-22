/**
 * Default G1-G5 AAC phrase groups and gross-motor gesture settings.
 * Used directly in static / GitHub Pages mode and as fallback schema defaults.
 */

export const VALID_GROUP_IDS = ["G1", "G2", "G3", "G4", "G5"];
export const VALID_DIRECTIONS = ["left", "up", "right", "down"];

export const DEFAULT_GROUPS = {
  G1: {
    id: "G1",
    motion: "M1",
    direction: "left",
    direction_label: "向左選項",
    title: "生理需求",
    icon: "💧",
    color: "#38bdf8",
    phrases: {
      left: "我想喝水",
      up: "我肚子餓了，想吃東西",
      right: "我需要上廁所",
      down: "請幫我調整姿勢",
    },
  },
  G2: {
    id: "G2",
    motion: "M2",
    direction: "up",
    direction_label: "向上選項",
    title: "醫療不適",
    icon: "🩺",
    color: "#fb7185",
    phrases: {
      left: "我身體不太舒服",
      up: "這裡會痛，請幫我看一下",
      right: "我有點頭暈想吐",
      down: "請幫我叫護理師或照顧者",
    },
  },
  G3: {
    id: "G3",
    motion: "M3",
    direction: "right",
    direction_label: "向右選項",
    title: "日常回應",
    icon: "💬",
    color: "#34d399",
    phrases: {
      left: "是的，好的",
      up: "不用，謝謝",
      right: "謝謝你的幫忙",
      down: "請稍等我一下",
    },
  },
  G4: {
    id: "G4",
    motion: "M4",
    direction: "down",
    direction_label: "向下選項",
    title: "環境協助",
    icon: "💡",
    color: "#fbbf24",
    phrases: {
      left: "有點冷，請幫我蓋被子",
      up: "有點熱，請開風扇或冷氣",
      right: "請幫我開燈或關燈",
      down: "請幫我拿手機或眼鏡",
    },
  },
  G5: {
    id: "G5",
    motion: "M5",
    direction: "center",
    direction_label: "確認送出 / 快捷",
    title: "緊急快捷",
    icon: "🔔",
    color: "#a78bfa",
    phrases: {
      left: "我需要立即幫忙！",
      up: "我呼吸有點困難，請立刻協助！",
      right: "請幫我聯絡家人",
      down: "我沒事了，謝謝關心",
    },
  },
};

export const DEFAULT_SETTINGS = {
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
  mirrorCamera: true,
  speechEnabled: true,
  soundEffects: true,
  speechRate: 1.0,
  autoReturnAfterSpeak: true,
};

export function cloneDefaultConfig() {
  return {
    groups: structuredClone(DEFAULT_GROUPS),
    settings: structuredClone(DEFAULT_SETTINGS),
  };
}

export function mergeConfigWithDefaults(raw) {
  const merged = cloneDefaultConfig();
  if (!raw || typeof raw !== "object") return merged;

  if (raw.groups && typeof raw.groups === "object") {
    for (const gid of VALID_GROUP_IDS) {
      const ug = raw.groups[gid];
      if (!ug || typeof ug !== "object") continue;
      const target = merged.groups[gid];
      if (typeof ug.title === "string" && ug.title.trim()) {
        target.title = ug.title.trim().slice(0, 24);
      }
      if (typeof ug.icon === "string" && ug.icon.trim()) {
        target.icon = ug.icon.trim().slice(0, 8);
      }
      if (ug.phrases && typeof ug.phrases === "object") {
        for (const dir of VALID_DIRECTIONS) {
          const val = ug.phrases[dir];
          if (typeof val === "string" && val.trim()) {
            target.phrases[dir] = val.trim().slice(0, 80);
          }
        }
      }
    }
  }

  if (raw.settings && typeof raw.settings === "object") {
    merged.settings = { ...merged.settings, ...raw.settings };
  }

  return merged;
}
