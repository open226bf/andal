/** Éditeur (blocs, figures, collaboration, envois) et bibliothèque commune (API, thèmes, routes). */
export default {
  // editor/nodes.tsx: figures, légendes
  'Faire défiler': 'Scroll',
  Légende: 'Caption',
  'Figure {n}': 'Figure {n}',
  'Listing {n}': 'Listing {n}',
  Source: 'Source',

  // Bloc Mermaid
  'Diagramme Mermaid': 'Mermaid diagram',
  'Le diagramme ne se lit pas: {error}': 'The diagram can’t be read: {error}',
  'Source Mermaid': 'Mermaid source',

  // Bloc OpenAPI
  'Spec {name}, version publiée n° {sequence}': 'Spec {name}, published version {sequence}',
  'Ouvrir dans Redoc': 'Open in Redoc',
  'Copie gardée dans la page: la spec n’est plus lisible ici, ou l’opération en a été retirée.':
    'Saved copy in the page: the spec can no longer be read here, or the operation was removed from it.',
  'Copie de {file}, sans lien avec une spec publiée.': 'Copy of {file}, not linked to a published spec.',
  Opération: 'Operation',
  Paramètres: 'Parameters',
  Nom: 'Name',
  Type: 'Type',
  Description: 'Description',
  requis: 'required',
  'Corps de la requête': 'Request body',
  Champ: 'Field',
  'Ni paramètre ni corps de requête.': 'No parameters or request body.',
  Réponses: 'Responses',
  'Chargement de l’opération…': 'Loading the operation…',
  'Opération introuvable dans {file}.': 'Operation not found in {file}.',
  'Opération introuvable dans la spec.': 'Operation not found in the spec.',

  // Bloc draw.io
  'Schéma vide': 'Empty diagram',
  'Modifier dans draw.io': 'Edit in draw.io',

  // Image
  Image: 'Image',
  'Image indisponible: supprimée, ou sur une page que vous ne lisez pas.': 'Image unavailable: deleted, or on a page you can’t read.',
  'Taille réelle': 'Full size',
  'Texte alternatif': 'Alt text',
  "Ce que montre l'image, pour qui ne la voit pas": 'What the image shows, for people who can’t see it',

  // Pièce jointe
  Fichier: 'File',
  fichier: 'file',
  Télécharger: 'Download',
  'Fichier indisponible': 'File unavailable',

  // Encadré, code
  Encadré: 'Callout',
  texte: 'text',
  Code: 'Code',
  'Copier le code': 'Copy code',
  'Commande shell.': 'Shell command.',
  'Code {language}.': '{language} code.',

  // editor/DocEditor.tsx: collaboration
  "Le serveur de collaboration a refusé l'accès à cette page.": 'The collaboration server denied access to this page.',
  'Le serveur n’enregistre plus cette page: la dernière modification contient un élément qu’il refuse. Annulez-la (⌘Z ou Ctrl Z); tant que ce message reste là, rien n’est sauvegardé.':
    'The server has stopped saving this page: the last change contains something it rejects. Undo it (⌘Z or Ctrl Z); while this message is showing, nothing is saved.',
  'Contenu de la page': 'Page content',
  'Connexion perdue: les modifications seront envoyées au retour du réseau.': 'Connection lost: your changes will be sent once the network is back.',
  'Chargement de la page': 'Loading page',

  // editor/DrawioEditor.tsx
  Schéma: 'Diagram',
  'Éditeur draw.io': 'draw.io editor',
  'Modifier le schéma': 'Edit diagram',
  Fermer: 'Close',

  // lib/api.ts
  'L’action a échoué. Réessayez dans un instant.': 'The action failed. Try again in a moment.',

  // lib/redoc.ts
  'Redoc ne s’est pas initialisé.': 'Redoc didn’t initialize.',
  'Redoc ne se charge pas.': 'Redoc won’t load.',
} satisfies Record<string, string>;
