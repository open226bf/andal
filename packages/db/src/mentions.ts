/**
 * Citations dans un commentaire: `@lea`, `@thomas.r`. Le @ doit ouvrir un mot
 * (début du texte, après un blanc ou une ponctuation ouvrante), pour ne pas
 * prendre une adresse email pour une citation.
 */
const MENTION = /(^|[\s([{«"'’])@([a-z0-9._-]{2,40})/gi;

/** Identifiants cités, en minuscules, sans doublon. Un point final est de la ponctuation: « merci @lea. ». */
export function mentionedUsernames(body: string): string[] {
  const found = new Set<string>();
  for (const match of body.matchAll(MENTION)) {
    const raw = match[2]!.toLowerCase();
    found.add(raw);
    const trimmed = raw.replace(/[._-]+$/, '');
    if (trimmed.length >= 2) found.add(trimmed);
  }
  return [...found];
}
