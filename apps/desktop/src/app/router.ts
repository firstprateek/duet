import type { MonthKey } from "@duet/core";

export type Route =
  | { name: "month"; month: MonthKey | null }
  | { name: "history"; month: MonthKey | null }
  | { name: "uploads"; month: MonthKey | null }
  | { name: "sort"; fileId: string | null }
  | { name: "add"; fileId: string }
  | { name: "trends" }
  | { name: "transactions"; month: MonthKey | null; categoryId: string | null }
  | { name: "settings" }
  | { name: "setup" };

const MONTH = /^\d{4}-\d{2}$/;

export function parseHash(hash: string): Route {
  const [path = "", query = ""] = hash.replace(/^#\/?/, "").split("?");
  const parts = path.split("/").filter(Boolean);
  const params = new URLSearchParams(query);
  const month = (value: string | undefined) => (value && MONTH.test(value) ? value : null);
  switch (parts[0]) {
    case "month":
      return parts[2] === "history"
        ? { name: "history", month: month(parts[1]) }
        : { name: "month", month: month(parts[1]) };
    case "uploads":
      return { name: "uploads", month: month(parts[1]) };
    case "sort":
      return parts[2] === "add" && parts[1]
        ? { name: "add", fileId: parts[1] }
        : { name: "sort", fileId: parts[1] ?? null };
    case "trends":
      return { name: "trends" };
    case "transactions":
      return {
        name: "transactions",
        month: month(params.get("month") ?? undefined),
        categoryId: params.get("category"),
      };
    case "settings":
      return { name: "settings" };
    case "setup":
      return { name: "setup" };
    default:
      return { name: "month", month: null };
  }
}

export function toHash(route: Route): string {
  switch (route.name) {
    case "month":
      return route.month ? `#/month/${route.month}` : "#/month";
    case "history":
      return `#/month/${route.month ?? "latest"}/history`;
    case "uploads":
      return route.month ? `#/uploads/${route.month}` : "#/uploads";
    case "sort":
      return route.fileId ? `#/sort/${route.fileId}` : "#/sort";
    case "add":
      return `#/sort/${route.fileId}/add`;
    case "trends":
      return "#/trends";
    case "transactions": {
      const q = new URLSearchParams();
      if (route.month) q.set("month", route.month);
      if (route.categoryId) q.set("category", route.categoryId);
      const s = q.toString();
      return s ? `#/transactions?${s}` : "#/transactions";
    }
    case "settings":
      return "#/settings";
    case "setup":
      return "#/setup";
  }
}
