/** Migrer: modèles de page, exports, liens publics, imports. */
export default {
  // PageActions: nouvelle page à partir d'un modèle
  'Page vide': 'Blank page',
  'Une page blanche, à écrire de zéro.': 'An empty page, to write from scratch.',
  'Partir de': 'Start from',

  // ExportMenu
  'Exporter la page': 'Export page',
  'Exporter « {title} »': 'Export “{title}”',
  Markdown: 'Markdown',
  'Le texte et les liens, à relire partout': 'Text and links, readable anywhere',
  PDF: 'PDF',
  'Mise en page du PDF…': 'Laying out the PDF…',
  'Mis en page pour l’impression, schémas compris': 'Laid out for print, diagrams included',

  // VolumeMenu
  'Plus d’actions sur {name}': 'More actions for {name}',
  'Importer, exporter': 'Import, export',
  'Importer des pages…': 'Import pages…',
  'Markdown, Notion ou Confluence': 'Markdown, Notion or Confluence',
  'Exporter le volume': 'Export volume',
  'Archive Markdown, fichiers compris': 'Markdown archive, files included',

  // ImportDialog
  'Importer des pages dans {name}': 'Import pages into {name}',
  'Archive trop lourde: {n} Mo au plus.': 'Archive too large: {n} MB at most.',
  'Un fichier .md, ou un dossier zippé: un dossier par page parente, les images à côté. L’archive d’un volume exporté d’Andal se réimporte telle quelle.':
    'A .md file, or a zipped folder: one folder per parent page, images alongside. A volume exported from Andal imports back as is.',
  Notion: 'Notion',
  'Export « Markdown & CSV », avec les sous-pages: les bases deviennent des tableaux.': '“Markdown & CSV” export, with subpages: databases become tables.',
  Confluence: 'Confluence',
  'Export HTML d’un espace: arborescence, encadrés, code, tableaux, images et pièces jointes.': 'HTML export of a space: page tree, panels, code, tables, images and attachments.',
  'Choisir un fichier…': 'Choose a file…',
  '.zip, .md ou .html, {n} Mo au plus': '.zip, .md or .html, {n} MB at most',
  'Ranger les pages': 'Place the pages',
  'Au premier niveau du volume': 'At the top level of the volume',
  'Sous « {number} {title} »': 'Under “{number} {title}”',
  'Les pages importées prennent les droits de leur destination. Rien n’est remplacé: elles s’ajoutent à la suite.':
    'Imported pages take the permissions of where they land. Nothing is replaced: they are added after the existing pages.',
  Importer: 'Import',
  'Import de {file} en cours…': 'Importing {file}…',
  '{n} page importée': '{n} page imported',
  '{n} pages importées': '{n} pages imported',
  '{n} fichier': '{n} file',
  '{n} fichiers': '{n} files',
  '{n} remarque': '{n} note',
  '{n} remarques': '{n} notes',
  'Ouvrir la première page': 'Open the first page',
  'L’import a échoué.': 'The import failed.',
  'Choisir un autre fichier': 'Choose another file',

  // SharePanel: lien public
  'Lien public': 'Public link',
  'Lisible sans compte, par quiconque a l’adresse. Ni commentaires, ni historique.': 'Readable without an account by anyone who has the address. No comments, no history.',
  'Tout le volume est public.': 'The whole volume is public.',
  'Cette page et ses sous-pages sont publiques.': 'This page and its subpages are public.',
  'Cette page est publique, sans ses sous-pages.': 'This page is public, without its subpages.',
  'Publique avec « {title} » et ses sous-pages.': 'Public along with “{title}” and its subpages.',
  'Lecture réservée: cette page ne peut pas être publique, même par un lien de sa parente ou du volume.':
    'Read access is restricted: this page can’t be public, not even through a link on its parent or on the volume.',
  'Adresse publique': 'Public address',
  'Retirer ce lien': 'Remove this link',
  'Retirer le lien du volume': 'Remove the volume link',
  'Avec ses sous-pages': 'With its subpages',
  'Publier cette page': 'Publish this page',
  'Publier tout le volume': 'Publish the whole volume',
  'Seuls les admins du volume publient un lien public.': 'Only volume admins publish a public link.',
  'Une page restreinte en lecture n’est jamais publique, même dans un volume publié. Retirer un lien le coupe aussitôt.':
    'A page with restricted read access is never public, even in a published volume. Removing a link cuts it off immediately.',

  // PublicPage
  'Ce lien ne mène plus nulle part': 'This link no longer leads anywhere',
  'Il a été retiré, ou la page qu’il partageait n’est plus publique.': 'It was removed, or the page it shared is no longer public.',
  '{n} page publique': '{n} public page',
  '{n} pages publiques': '{n} public pages',
  'Lecture publique': 'Public reading',
  "Cette page n'est pas dans ce partage.": 'This page isn’t part of this share.',
  'Sommaire du partage': 'Contents of the share',
  'Vol. {n} · {name}': 'Vol. {n} · {name}',
  'Publié avec Andal': 'Published with Andal',
  'Mise à jour le {date}': 'Updated {date}',
} satisfies Record<string, string>;
