// Presentation stays local: providers never have to allocate unique icons.
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const isEmoji = (value) => /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(value);
export const groupEmoji = (name) => [...segmenter.segment(String(name || ""))].map(({ segment }) => segment).filter(isEmoji);
export const stripGroupEmoji = (name) => [...segmenter.segment(String(name || ""))]
  .map(({ segment }) => isEmoji(segment) ? "" : segment).join("").replace(/\s+/gu, " ").trim();
const emojiKey = (emoji) => emoji.replace(/[\uFE0E\uFE0F\u{1F3FB}-\u{1F3FF}]/gu, "");
const key = (name) => String(name || "").normalize("NFKC").trim().toLowerCase();
const palette = ["💼", "💻", "📚", "🎨", "🎧", "🌍", "🛒", "🧪", "🌱", "💬", "📷", "🏠", "🚀", "🧭", "🍎", "🎮", "🎬", "💡", "📊", "🧩", "🔧", "🎯", "☕", "📰", "🎵", "🏆", "🧠", "💎", "🔒", "✈️", "📅", "📦"];
// A label hint only; this never classifies tabs or defines their categories.
const topicIcons = [
  [/dev|code|program|github|разраб|программ/iu, "💻"],
  [/read|research|study|learn|book|чтен|учеб|исслед/iu, "📚"],
  [/financ|bank|money|invoice|финанс|банк|деньг/iu, "💰"],
  [/design|figma|дизайн/iu, "🎨"], [/media|music|video|podcast|медиа|музык|видео/iu, "🎧"],
  [/shop|buy|cart|магаз|покуп/iu, "🛒"], [/travel|trip|путеш|поезд/iu, "✈️"],
  [/game|игр/iu, "🎮"], [/work|business|project|работ|проект/iu, "💼"],
];
let extendedPalette;
const candidates = () => extendedPalette ||= [...new Set([...palette, ...Array.from({ length: 0x900 }, (_, index) => String.fromCodePoint(0x1f300 + index))
  .filter((char) => /\p{Emoji_Presentation}/u.test(char) && !/\p{Emoji_Modifier}/u.test(char))])];

// Keep exact destinations for identity/reconciliation. An emoji spelling change
// may reuse an existing destination only when the plain name is unambiguous.
export const canonicalizeGroupNames = (plan, existingNames) => {
  const exact = new Map(existingNames.map((name) => [key(name), name]));
  const plain = new Map();
  for (const name of existingNames) {
    const normalized = key(stripGroupEmoji(name));
    if (normalized) plain.set(normalized, plain.has(normalized) ? null : name);
  }
  const canonical = (name) => exact.get(key(name)) || plain.get(key(stripGroupEmoji(name))) || name;
  return { ...plan,
    assignedToExisting: plan.assignedToExisting.map((entry) => ({ ...entry, groupName: canonical(entry.groupName) })),
    newGroups: plan.newGroups.map((group) => ({ ...group, name: canonical(group.name) })),
  };
};

// Untouched/manual groups reserve their icons. Preserve all available existing
// choices first, then fill missing/duplicate icons in deterministic order.
export const uniqueGroupLabels = (names, reservedNames = [], enabled = true) => {
  if (!enabled) return names.map((name) => stripGroupEmoji(name) || "Group");
  const used = new Set(reservedNames.flatMap(groupEmoji).map(emojiKey));
  const icons = names.map((name) => {
    const icon = groupEmoji(name).find((candidate) => !used.has(emojiKey(candidate)));
    if (icon) used.add(emojiKey(icon));
    return icon;
  });
  let cursor = 0, overflow = 0;
  return names.map((name, index) => {
    let icon = icons[index];
    const plainName = stripGroupEmoji(name) || "Group";
    if (!icon) {
      const hint = topicIcons.find(([pattern]) => pattern.test(plainName))?.[1];
      if (hint && !used.has(emojiKey(hint))) { icon = hint; used.add(emojiKey(icon)); }
    }
    while (!icon) {
      const candidate = palette[cursor] || candidates()[cursor] || `🔖${String(++overflow).split("").map((digit) => `${digit}\uFE0F\u20E3`).join("")}`;
      cursor++;
      if (!used.has(emojiKey(candidate))) { icon = candidate; used.add(emojiKey(icon)); }
    }
    return `${icon} ${plainName}`;
  });
};
