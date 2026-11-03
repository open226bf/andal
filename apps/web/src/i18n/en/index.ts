/**
 * Catalogue anglais: la phrase française de l'interface → sa traduction.
 * Un fichier par partie de l'application (pages, composants, éditeur…);
 * ils sont tous fusionnés ici, sans liste à tenir à jour.
 */
const parts = import.meta.glob<{ default: Record<string, string> }>(['./*.ts', '!./index.ts'], { eager: true });

export const en: Record<string, string> = Object.assign({}, ...Object.values(parts).map((part) => part.default));
