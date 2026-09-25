/**
 * The starter categories from the mocks. Top-level categories carry a chart color from
 * the pastel set and a lighter "bubble" color for icons; children inherit both.
 */
export interface Category {
  id: string;
  name: string;
  parentId: string | null;
  icon: string;
  color: string;
  bubble: string;
  order: number;
  archived?: boolean;
}

export const PALETTE = {
  peach: { color: "#F9B98F", bubble: "#FFE3D3" },
  butter: { color: "#F2CF5B", bubble: "#FFF0C2" },
  sky: { color: "#8EC3F2", bubble: "#DCEEFF" },
  lilac: { color: "#BBA2F0", bubble: "#ECE3FF" },
  mint: { color: "#86D5A9", bubble: "#D9F4E6" },
  pink: { color: "#F39DBE", bubble: "#FFE1EC" },
  coral: { color: "#F4A293", bubble: "#FFE4DE" },
  aqua: { color: "#7ED0C8", bubble: "#D8F3F0" },
  sand: { color: "#D8BF97", bubble: "#F5EBDD" },
  grey: { color: "#C9C0D3", bubble: "#F0ECE6" },
} as const;

type Swatch = keyof typeof PALETTE;

interface Group {
  id: string;
  name: string;
  icon: string;
  swatch: Swatch;
  children: Array<[id: string, name: string, icon: string]>;
}

const GROUPS: Group[] = [
  {
    id: "home",
    name: "Home",
    icon: "home",
    swatch: "peach",
    children: [
      ["rent", "Rent & mortgage", "home"],
      ["utilities", "Utilities", "bolt"],
      ["internet-phone", "Internet & phone", "wifi"],
      ["home-upkeep", "Repairs & upkeep", "wrench"],
      ["insurance", "Insurance", "shield"],
    ],
  },
  {
    id: "food",
    name: "Food",
    icon: "bowl",
    swatch: "butter",
    children: [
      ["groceries", "Groceries", "basket"],
      ["dining-out", "Dining out", "bowl"],
      ["coffee", "Coffee", "cup"],
    ],
  },
  {
    id: "shopping",
    name: "Shopping",
    icon: "bag",
    swatch: "lilac",
    children: [
      ["household-goods", "Household goods", "bag"],
      ["clothes", "Clothes", "shirt"],
      ["electronics", "Electronics", "laptop"],
    ],
  },
  {
    id: "getting-around",
    name: "Getting around",
    icon: "car",
    swatch: "mint",
    children: [
      ["gas", "Gas & charging", "fuel"],
      ["rideshare", "Rideshare & taxis", "car"],
      ["parking", "Parking & tolls", "parking"],
      ["transit", "Transit", "train"],
      ["car", "Car upkeep", "wrench"],
    ],
  },
  {
    id: "travel",
    name: "Travel",
    icon: "suitcase",
    swatch: "sky",
    children: [
      ["flights", "Flights", "plane"],
      ["stays", "Stays", "bed"],
      ["travel-other", "Trip extras", "suitcase"],
    ],
  },
  {
    id: "fun",
    name: "Fun",
    icon: "music",
    swatch: "pink",
    children: [
      ["subscriptions", "Subscriptions", "music"],
      ["entertainment", "Going out", "ticket"],
      ["hobbies", "Hobbies", "sparkle"],
    ],
  },
  {
    id: "health",
    name: "Health",
    icon: "heart",
    swatch: "coral",
    children: [
      ["pharmacy", "Pharmacy", "pill"],
      ["doctor", "Doctors & dental", "heart"],
      ["fitness", "Fitness", "dumbbell"],
    ],
  },
  {
    id: "gifts",
    name: "Gifts",
    icon: "gift",
    swatch: "aqua",
    children: [
      ["gifts-given", "Gifts", "gift"],
      ["giving", "Giving", "hand-heart"],
    ],
  },
  {
    id: "personal-care",
    name: "Personal care",
    icon: "sparkle",
    swatch: "sand",
    children: [["hair-beauty", "Hair & beauty", "scissors"]],
  },
  {
    id: "other",
    name: "Other",
    icon: "dots",
    swatch: "grey",
    children: [
      ["fees", "Fees & interest", "receipt"],
      ["education", "Learning", "book"],
      ["pets", "Pets", "paw"],
      ["uncategorized", "Something else", "dots"],
    ],
  },
];

export const STARTER_CATEGORIES: Category[] = GROUPS.flatMap((group, groupIndex) => {
  const swatch = PALETTE[group.swatch];
  const parent: Category = {
    id: group.id,
    name: group.name,
    parentId: null,
    icon: group.icon,
    color: swatch.color,
    bubble: swatch.bubble,
    order: groupIndex * 100,
  };
  const children = group.children.map(([id, name, icon], i) => ({
    id,
    name,
    parentId: group.id,
    icon,
    color: swatch.color,
    bubble: swatch.bubble,
    order: groupIndex * 100 + i + 1,
  }));
  return [parent, ...children];
});

export const FALLBACK_CATEGORY_ID = "uncategorized";

/** The top-level category a category rolls up to (itself when it is top-level). */
export function topLevelOf(
  categoryId: string,
  categories: readonly Category[],
): Category | undefined {
  const byId = new Map(categories.map((c) => [c.id, c]));
  let current = byId.get(categoryId);
  let guard = 0;
  while (current?.parentId && guard++ < 10) current = byId.get(current.parentId);
  return current;
}

/** "Food › Groceries" */
export function categoryPath(categoryId: string, categories: readonly Category[]): string {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const c = byId.get(categoryId);
  if (!c) return "";
  if (!c.parentId) return c.name;
  const parent = byId.get(c.parentId);
  return parent ? `${parent.name} › ${c.name}` : c.name;
}
