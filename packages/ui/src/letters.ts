/**
 * What an avatar shows: the first letter of a name, or the first two when both of us start
 * with the same one (Jack and Jill show "Ja" and "Ji"), since color alone is easy to miss.
 */
export function avatarLetters(name: string, pair: readonly string[] = []): string {
  const own = name.trim();
  if (!own) return "?";
  const first = own.charAt(0).toUpperCase();
  const clash = pair.some((other) => {
    const o = other.trim();
    return o !== "" && o !== own && o.charAt(0).toUpperCase() === first;
  });
  return clash ? first + own.charAt(1).toLowerCase() : first;
}
