/**
 * Rounded stroke icons on a 24×24 grid, drawn to sit inside pastel bubbles. Never emoji.
 * Paths with circles are written as arcs so every icon is a single path.
 */
const circle = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`;

export const ICONS: Record<string, string> = {
  // From the mocks
  basket: "M4 10h16l-1.6 9H5.6z M8 10l3-5 M16 10l-3-5",
  cup: "M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z M16 11h1.5a2.5 2.5 0 0 1 0 5H16",
  suitcase: "M6 7h12a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-7a3 3 0 0 1 3-3z M9 7V5h6v2",
  bag: "M5 8h14l-1 12H6z M9 8V6a3 3 0 0 1 6 0v2",
  card: "M5 6h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z M3 10h18",
  back: "M9 5L4 10l5 5 M4 10h10a5 5 0 0 1 0 10h-1",
  bowl: "M4 12h16a8 8 0 0 1-16 0z M9 8c0-1.2 1-1.8 1-3 M14 8c0-1.2 1-1.8 1-3",
  bolt: "M13 3L5 13h6l-1 8 8-10h-6z",
  music: `M9 18V6l10-2v12 ${circle(7, 18, 2)} ${circle(17, 16, 2)}`,
  sliders: `M4 7h10M18 7h2M4 17h4M12 17h8 ${circle(16, 7, 2)} ${circle(10, 17, 2)}`,
  plus: "M12 5v14M5 12h14",
  check: "M5 12.5l4.5 4.5L19 7.5",
  "arrow-right": "M5 12h14M13 6l6 6-6 6",
  calendar:
    "M6.5 5h11a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-11a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3z M3.5 10h17M8 3v4M16 3v4",
  sun: `${circle(12, 12, 4)} M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4`,
  moon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z",
  auto: `${circle(12, 12, 8)} M12 4a8 8 0 0 1 0 16z`,
  // Categories and the rest
  home: "M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z",
  wifi: "M4.5 9.5a11 11 0 0 1 15 0 M7.5 13a6.5 6.5 0 0 1 9 0 M12 17h.01",
  wrench: "M14.5 5.5a4 4 0 0 0-5 5L4 16l4 4 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-3-3z",
  shield: "M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z",
  shirt: "M8 4L4 7l2 4 2-1v10h8V10l2 1 2-4-4-3c-1 2-2.4 3-4 3s-3-1-4-3z",
  laptop: "M6 5h12a1 1 0 0 1 1 1v9H5V6a1 1 0 0 1 1-1z M3 18h18",
  car: "M5 16v-4l2-5h10l2 5v4z M5 16v2 M19 16v2 M8 13h.01 M16 13h.01",
  fuel: "M5 20V5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v15 M4 20h11 M5 10h9 M14 9h2l2 2v6a1.5 1.5 0 0 0 3 0V9l-3-3",
  parking:
    "M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z M9 17V7h4a3 3 0 0 1 0 6H9",
  train:
    "M7 4h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M5 11h14 M8 21l2-4 M16 21l-2-4",
  plane: "M3 13l18-7-7 16-3-6z M11 16l3-4",
  bed: "M3 18V7 M3 14h18v4 M21 14v-2a3 3 0 0 0-3-3h-7v5 M7 11.5h.01",
  ticket: "M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4z M13 7v10",
  sparkle: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18",
  heart: "M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z",
  pill: "M8.5 15.5l7-7a3.5 3.5 0 0 0-5-5l-7 7a3.5 3.5 0 0 0 5 5z M6.5 9.5l5 5",
  dumbbell: "M6 8v8 M3 10v4 M18 8v8 M21 10v4 M6 12h12",
  gift: "M4 10h16v10H4z M3 7h18v3H3z M12 7v13 M12 7c-1.5-3-5-3-5-1s3 1 5 1c2 0 5 1 5-1s-3.5-2-5 1",
  "hand-heart":
    "M3 14h4l5 3 6-3v-2l-6 1-3-2H3 M14 9s-3-1.8-3-4a2 2 0 0 1 3-1 2 2 0 0 1 3 1c0 2.2-3 4-3 4z",
  scissors: `${circle(6, 7, 2)} ${circle(6, 17, 2)} M7.5 8.5L20 18 M7.5 15.5L20 6`,
  dots: "M6 12h.01M12 12h.01M18 12h.01",
  receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6M9 12h6",
  book: "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z M4 19V5",
  paw: "M12 14c-3 0-5 2.5-5 4.5 0 1.4 1.3 2 3 1.5 1.3-.4 2.7-.4 4 0 1.7.5 3-.1 3-1.5 0-2-2-4.5-5-4.5z M6.5 10.5h.01 M10 7h.01 M14 7h.01 M17.5 10.5h.01",
  upload: "M12 16V4 M7 9l5-5 5 5 M5 20h14",
  file: "M7 3h7l5 5v13H7z M14 3v5h5",
  trash: "M5 7h14 M10 7V4h4v3 M7 7l1 13h8l1-13",
  search: `${circle(11, 11, 7)} M20 20l-4-4`,
  "chevron-left": "M15 5l-7 7 7 7",
  "chevron-right": "M9 5l7 7-7 7",
  x: "M6 6l12 12M18 6L6 18",
  pencil: "M4 20h4L19 9l-4-4L4 16z",
  clock: `${circle(12, 12, 9)} M12 7v5l3 2`,
  lock: "M6 11h12v9H6z M8 11V8a4 4 0 0 1 8 0v3",
  list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  server: "M4 9h16a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2z M17 12.5h.01",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7 M20 5v6h-6",
  cash: "M4 7h16v10H4z M12 12h.01 M7 12h.01 M17 12h.01",
  swap: "M7 7h13 M16 3l4 4-4 4 M17 17H4 M8 13l-4 4 4 4",
};

export function iconPath(name: string): string {
  return ICONS[name] ?? ICONS.dots!;
}
