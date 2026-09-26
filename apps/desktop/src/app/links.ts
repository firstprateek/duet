/** Duet's website: the download page, the join page and the demo (GitHub Pages). */
export const SITE = "https://firstprateek.github.io/duet";

/**
 * A join link for the other one of us. The code rides after the #, which browsers never send
 * to a server, so neither GitHub nor anyone else sees it.
 */
export function joinLink(code: string): string {
  return `${SITE}/join/#${code}`;
}
