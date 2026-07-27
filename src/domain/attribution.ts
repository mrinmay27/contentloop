/** Credit for third-party media.
 *
 *  Pexels' API guidelines ask that the photographer be credited and linked
 *  when their content is shown. Attribution has to be captured at download
 *  time: once a clip is a plain .mp4 on disk there is no way to work backwards
 *  to who made it.
 *
 *  Pure — no I/O.
 */

export interface Attribution {
  provider: "pexels";
  /** Absent on some records; credit the provider alone rather than "undefined". */
  author?: string;
  /** Page for the clip, so the credit can link back. */
  sourceUrl?: string;
}

const PROVIDER_LABEL: Record<Attribution["provider"], string> = {
  pexels: "Pexels",
};

export function creditLine(attr: Attribution): string {
  const provider = PROVIDER_LABEL[attr.provider];
  const author = attr.author?.trim();
  return author ? `${author} · ${provider}` : provider;
}

/** One line per distinct credit — three clips by one photographer is one
 *  credit, not three. */
export function creditsFor(items: Array<Attribution | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (!item?.provider) continue;
    const line = creditLine(item);
    if (seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  return out;
}
