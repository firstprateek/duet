/**
 * Nightly copies of the relay database: the last 30 days, plus the first copy of each of
 * the last 12 months. What's in them is ciphertext, so they can go anywhere.
 */

const NAME = /^relay-(\d{4}-\d{2}-\d{2})\.db$/;

export function backupName(date: Date): string {
  return `relay-${date.toISOString().slice(0, 10)}.db`;
}

/** Which backup files to delete, given every file name in the folder. */
export function backupsToRemove(names: readonly string[], today: Date): string[] {
  const dated = names
    .map((name) => ({ name, date: NAME.exec(name)?.[1] }))
    .filter((b): b is { name: string; date: string } => !!b.date)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const dayMs = 86_400_000;
  const todayMs = Date.parse(`${today.toISOString().slice(0, 10)}T00:00:00Z`);
  const thisMonth = today.getUTCFullYear() * 12 + today.getUTCMonth();
  const firstOfMonth = new Map<string, string>();
  for (const b of dated) {
    const month = b.date.slice(0, 7);
    if (!firstOfMonth.has(month)) firstOfMonth.set(month, b.name);
  }
  return dated
    .filter((b) => {
      const age = (todayMs - Date.parse(`${b.date}T00:00:00Z`)) / dayMs;
      if (age < 30) return false;
      const [y, m] = b.date.split("-").map(Number) as [number, number];
      const monthsAgo = thisMonth - (y * 12 + (m - 1));
      return !(monthsAgo < 12 && firstOfMonth.get(b.date.slice(0, 7)) === b.name);
    })
    .map((b) => b.name);
}
