/** Le DOM sans navigateur de turndown, utilisé directement pour lire l'index d'un export Confluence. */
declare module '@mixmark-io/domino' {
  export function createDocument(html?: string, force?: boolean): Document;
}
