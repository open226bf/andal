---
name: Andal
description: Wiki de documentation auto-hébergé pour équipes tech, composé comme une édition technique reliée en volumes.
colors:
  paper: "#FFFFFF"
  desk: "#F3F4F7"
  shelf: "#E4E7EE"
  ink: "#1C2230"
  ink-2: "#4A5266"
  ink-3: "#646C80"
  rule: "#DDE1E8"
  rule-2: "#C6CCD7"
  hover: "#E8EBF1"
  code-bg: "#F6F7FA"
  hl: "#FFF0BF"
  hl-line: "#D99A1E"
  ok: "#1D7A46"
  ok-tint: "#E3F3EA"
  err: "#B3261E"
  err-tint: "#FBE9E7"
  t-cmd: "#3A2FA3"
  t-flag: "#8E2A19"
  t-str: "#0B5A51"
  t-var: "#7A5408"
  paper-dark: "#151922"
  desk-dark: "#10131A"
  shelf-dark: "#0B0D12"
  ink-dark: "#E7E9EF"
  ink-2-dark: "#B3B9C7"
  ink-3-dark: "#8D94A6"
  rule-dark: "#272D3A"
  rule-2-dark: "#3A4151"
  hover-dark: "#1E2330"
  code-bg-dark: "#0F1219"
  hl-dark: "#43381A"
  hl-line-dark: "#D9A440"
  hl-ink-dark: "#F6E3B0"
  ok-dark: "#6CCB94"
  ok-tint-dark: "#16301F"
  err-dark: "#F28B82"
  err-tint-dark: "#3A1A18"
  t-cmd-dark: "#B6AEF6"
  t-flag-dark: "#F5A797"
  t-str-dark: "#72D3C5"
  t-var-dark: "#F6CB73"
  vol-paiements: "#157F73"
  vol-paiements-on: "#FFFFFF"
  vol-paiements-tint: "#E2F3F0"
  vol-paiements-deep: "#0B5A51"
  vol-paiements-tint-dark: "#133A36"
  vol-paiements-deep-dark: "#72D3C5"
  vol-identite: "#5B4FD6"
  vol-identite-on: "#FFFFFF"
  vol-identite-tint: "#ECEAFC"
  vol-identite-deep: "#3A2FA3"
  vol-identite-tint-dark: "#29244D"
  vol-identite-deep-dark: "#B6AEF6"
  vol-donnees: "#F2B33D"
  vol-donnees-on: "#1C2230"
  vol-donnees-tint: "#FDF3DD"
  vol-donnees-deep: "#7A5408"
  vol-donnees-tint-dark: "#3B3016"
  vol-donnees-deep-dark: "#F6CB73"
  vol-mobile: "#C2366A"
  vol-mobile-on: "#FFFFFF"
  vol-mobile-tint: "#FBE7EF"
  vol-mobile-deep: "#8F1E48"
  vol-mobile-tint-dark: "#45182A"
  vol-mobile-deep-dark: "#F3A0BF"
  vol-plateforme: "#3B6FB6"
  vol-plateforme-on: "#FFFFFF"
  vol-plateforme-tint: "#E6EEF8"
  vol-plateforme-deep: "#1E4377"
  vol-plateforme-tint-dark: "#1A2C46"
  vol-plateforme-deep-dark: "#9FC2F1"
  vol-design: "#C93F28"
  vol-design-on: "#FFFFFF"
  vol-design-tint: "#FBE9E5"
  vol-design-deep: "#8E2A19"
  vol-design-tint-dark: "#46201A"
  vol-design-deep-dark: "#F5A797"
typography:
  display:
    fontFamily: "Atkinson Hyperlegible Next, system-ui, sans-serif"
    fontSize: "2.375rem"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Atkinson Hyperlegible Next, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Atkinson Hyperlegible Next, system-ui, sans-serif"
    fontSize: "1.1875rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.005em"
  lede:
    fontFamily: "Literata, Georgia, serif"
    fontSize: "1.25rem"
    fontWeight: 400
    lineHeight: 1.55
  body:
    fontFamily: "Literata, Georgia, serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.72
  ui:
    fontFamily: "Atkinson Hyperlegible Next, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  nav:
    fontFamily: "Atkinson Hyperlegible Next, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.3
  caption:
    fontFamily: "Atkinson Hyperlegible Next, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Atkinson Hyperlegible Next, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 700
  spine:
    fontFamily: "Atkinson Hyperlegible Next, system-ui, sans-serif"
    fontSize: "0.78rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.01em"
  code:
    fontFamily: "Atkinson Hyperlegible Mono, ui-monospace, SF Mono, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.7
rounded:
  mark: "3px"
  s: "6px"
  ctl: "8px"
  md: "10px"
  lg: "14px"
  pill: "999px"
spacing:
  measure: "640px"
  margin-col: "232px"
  gutter: "28px"
  page-top: "44px"
  page-bottom: "96px"
  shelf: "64px"
  toc: "280px"
  toc-laptop: "256px"
  band-height: "64px"
components:
  spine:
    backgroundColor: "{colors.vol-paiements}"
    textColor: "{colors.vol-paiements-on}"
    typography: "{typography.spine}"
    width: "38px"
  spine-current:
    width: "42px"
  toc-node:
    textColor: "{colors.ink}"
    typography: "{typography.nav}"
    rounded: "{rounded.ctl}"
    padding: "5px 8px"
    height: "34px"
  toc-node-hover:
    backgroundColor: "{colors.hover}"
  toc-node-current:
    backgroundColor: "{colors.vol-paiements-tint}"
    textColor: "{colors.vol-paiements-deep}"
  volume-band:
    backgroundColor: "{colors.vol-paiements}"
    textColor: "{colors.vol-paiements-on}"
    padding: "10px 28px"
    height: "64px"
  mode-toggle-active:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "5px 12px"
  button-paper:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "7px 14px"
  button-ink:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.md}"
    padding: "9px 14px"
  button-ghost:
    textColor: "{colors.ink-2}"
    rounded: "7px"
    padding: "4px 9px"
  button-ghost-hover:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.ink}"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "9px 12px"
  search:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-3}"
    rounded: "{rounded.md}"
    padding: "9px 10px 9px 12px"
  figure-frame:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.lg}"
    padding: "16px 12px 12px"
  code-block:
    backgroundColor: "{colors.code-bg}"
    textColor: "{colors.ink}"
    typography: "{typography.code}"
    rounded: "{rounded.lg}"
    padding: "14px 16px 16px"
  code-callout:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    size: "20px"
  note-box:
    backgroundColor: "{colors.vol-paiements-tint}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "16px 20px 6px 16px"
  api-head:
    backgroundColor: "{colors.desk}"
    padding: "14px 16px"
  api-verb:
    backgroundColor: "{colors.ok-tint}"
    textColor: "{colors.ok}"
    rounded: "{rounded.s}"
    padding: "5px 8px"
  you-badge:
    backgroundColor: "{colors.vol-paiements-tint}"
    textColor: "{colors.vol-paiements-deep}"
    rounded: "{rounded.pill}"
    padding: "1px 8px"
  popover:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.ctl}"
    width: "420px"
  slash-option-active:
    backgroundColor: "{colors.vol-paiements-tint}"
    textColor: "{colors.vol-paiements-deep}"
    rounded: "{rounded.md}"
    padding: "8px 10px"
---

# Design System: Andal

## Overview

**Creative North Star: "L'Édition technique"**

Chaque projet est un volume relié, chaque page une section numérotée d'un livre technique, dans la lignée d'O'Reilly, No Starch, Pragmatic et des RFC. Le papier est blanc froid, l'encre bleu-noir, et la seule couleur forte vient de la toile de reliure du volume ouvert: elle habille le dos sur l'étagère, le bandeau du volume, la section courante du sommaire, les numéros de figure, les liens et l'encadré. Changer de volume, c'est tirer un autre dos de l'étagère; toute la page change de toile, rien d'autre ne bouge.

La densité est celle d'un livre de référence, pas d'un tableau de bord: une colonne de lecture de 640 à 720px en Literata, selon la place, une marge droite de 232px pour les notes de marge (les commentaires), et une interface en Atkinson Hyperlegible Next qui reste en retrait. Les blocs techniques (Mermaid, OpenAPI, draw.io, code) sont traités comme des figures et listings numérotés avec légende, au même niveau de soin que la prose. Le mode édition ne change pas de décor: il révèle la construction de la page (contours de blocs, poignées, étiquettes de type, menu `/`).

Les droits se lisent comme un colophon: trois colonnes Écriture, Commentaire, Lecture, chacune avec son signe d'accès (plein, hachuré, contour), juste sous le titre. Le système refuse le wiki gris à accent bleu unique: la couleur appartient au volume, jamais à l'application.

**Key Characteristics:**
- Une toile saturée par volume, appliquée par variables (`--vol`, `--vol-on`, `--vol-tint`, `--vol-deep`) et jamais codée en dur dans un composant.
- Numérotation partout: dos (1 à 5), sommaire (3.2), titres (3.2.1), figures et listings (Figure 3.2, Listing 3.1), repères de code (1, 2), ancres de commentaire.
- Trois familles: Literata pour lire, Atkinson Hyperlegible Next pour agir, Atkinson Hyperlegible Mono pour le code.
- Surfaces plates; l'ombre n'existe que pour ce qui sort du plan (dos tiré, panneau, menu, tiroir mobile).
- Clair et sombre complets; les toiles restent identiques, seules leurs variantes tint et deep basculent.

### Passage au produit (React, Vite, Tailwind, Radix)

Les tokens vivent en propriétés CSS sur `:root` (thème clair), `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` et `:root[data-theme="dark"]` (thème sombre), et `[data-vol="<id>"]` (toile). Dans Tailwind, exposer ces variables plutôt que les hex: `colors.paper = 'var(--paper)'`, `colors.ink.DEFAULT/2/3`, `colors.rule.DEFAULT/2`, `colors.vol = { DEFAULT: 'var(--vol)', on: 'var(--vol-on)', tint: 'var(--vol-tint)', deep: 'var(--vol-deep)' }`; `fontFamily.ui/text/mono`; `borderRadius` s/ctl/md/lg; `boxShadow` pop/card/pull; `transitionTimingFunction.book = 'cubic-bezier(.16, 1, .3, 1)'`; `maxWidth.measure = '640px'`. Le volume courant se pose avec `data-vol` sur la racine, comme dans la maquette.

Ce qui est propre au prototype: les trois polices viennent de Google Fonts et doivent être auto-hébergées (le produit est auto-hébergé et ne doit pas appeler de CDN tiers); les icônes Phosphor sont chargées en police depuis unpkg et doivent passer par `@phosphor-icons/react` (SVG); Mermaid 11.4.1 vient d'unpkg et doit être une dépendance npm; le tiroir mobile, le panneau Partager (attribut `popover`) et le menu `/` doivent devenir des primitives Radix (Dialog, Popover) et des extensions TipTap. Tout le contenu (personnes, équipes, URL) est fictif.

## Colors

Papier froid et encre bleu-noir pour tout le texte, une toile de reliure saturée par volume, et des couleurs d'état réservées au code et aux réponses d'API.

### Primary (la toile du volume)
La couleur primaire n'est pas unique: c'est la toile du volume ouvert. Chaque volume définit six valeurs: la toile (`vol`), la couleur posée dessus (`vol-on`), un fond pâle (`vol-tint`), une encre foncée lisible sur papier (`vol-deep`), et leurs pendants sombres (`vol-tint-dark`, `vol-deep-dark`).

- **Sarcelle Paiements** (`vol-paiements`): volume 3 de la maquette, toile par défaut. Texte blanc.
- **Indigo Identité** (`vol-identite`): volume 1. Texte blanc.
- **Moutarde Données** (`vol-donnees`): volume 5. Seule toile claire: le texte posé dessus est l'encre (`vol-donnees-on`), pas du blanc.
- **Framboise Mobile** (`vol-mobile`): volume 4. Texte blanc.
- **Bleu de Prusse Plateforme** (`vol-plateforme`): volume 2. Texte blanc.
- **Tomate Design** (`vol-design`): toile définie et complète, aucun dos ne l'utilise encore dans la maquette.

Les toiles servent aussi de couleurs de personne pour les avatars (moutarde, indigo, framboise), avec la même règle de texte posé dessus.

### Secondary (surligné et ancres de commentaire)
- **Surligné papier** (`hl`) et **Fil ambre** (`hl-line`): passage commenté (`mark.anchor`, fond `hl`, soulignement 2px `hl-line`), pastille numérotée d'ancre (fond `hl-line`, chiffre en encre `#1C2230` dans les deux thèmes), et notes Mermaid. En sombre, le texte surligné passe en `hl-ink-dark`.

### Tertiary (états et coloration du code)
- **Vert validé** (`ok` sur `ok-tint`): verbe HTTP et réponses 2xx du bloc OpenAPI.
- **Rouge refus** (`err` sur `err-tint`): réponses 4xx, mention « requis ».
- **Coloration du code**: commande (`t-cmd`), option (`t-flag`), chaîne (`t-str`), variable ou nombre (`t-var`); les clés JSON reprennent `t-cmd`. Ces quatre teintes sont les encres deep des toiles indigo, tomate, sarcelle et moutarde: le code parle la langue de la reliure.

### Neutral
- **Papier** (`paper`): fond de page, cadres de figures, boutons papier sur le bandeau.
- **Bureau** (`desk`): fond du sommaire, en-tête OpenAPI, code en ligne, pastilles d'icônes.
- **Étagère** (`shelf`): fond de la colonne des dos, le plus sombre des neutres clairs.
- **Encre** (`ink`), **Encre 2** (`ink-2`), **Encre 3** (`ink-3`): texte principal, secondaire (lede, légendes, notes de marge), tertiaire (numéros du sommaire, métadonnées, placeholders).
- **Filet** (`rule`) et **Filet appuyé** (`rule-2`): bordures de cadres et séparateurs; `rule-2` pour les contours d'édition, l'interrupteur éteint et les bordures au survol.
- **Survol** (`hover`): fond de survol des lignes et boutons fantômes.
- **Fond de code** (`code-bg`): listings et schémas.

Le thème sombre remplace chaque neutre et chaque couleur d'état par sa variante `-dark`; les toiles `vol-*` et `vol-*-on` ne changent pas.

### Named Rules
**La règle de la toile.** La seule couleur saturée d'un écran est la toile du volume ouvert. Aucun composant ne porte un accent global de l'application; un composant qui a besoin de couleur lit `--vol`, `--vol-tint` ou `--vol-deep`.

**La règle de l'encre deep.** Sur papier, un texte coloré (lien, numéro de section, numéro de figure, marque d'accès, indice de défilement) utilise `vol-deep`, jamais `vol`. La toile pleine ne sert qu'en aplat (dos, bandeau, interrupteur actif, icône d'option active) ou en trait (bordures de nœuds de diagramme, survol du pager, filet haut des panneaux).

**La règle du texte posé.** Sur une toile, le texte est `vol-on`; c'est ce qui permet à la moutarde de porter de l'encre et aux autres toiles du blanc.

## Typography

**Display Font:** Atkinson Hyperlegible Next (avec system-ui, sans-serif)
**Body Font:** Literata (avec Georgia, serif), axe optique actif (`font-optical-sizing: auto`)
**Label/Mono Font:** Atkinson Hyperlegible Mono (avec ui-monospace, SF Mono, monospace)

**Character:** une interface à la lisibilité d'abord, franche et grasse, au-dessus d'une prose de livre en Literata; le mono partage l'ADN Atkinson pour que le code se lise comme l'interface.

### Hierarchy
- **Display** (700, 2.375rem, 1.1, -0.02em; 1.875rem sous 860px): titre de page, précédé de son numéro de section en `vol-deep`.
- **Headline** (700, 1.5rem, 1.25, -0.01em): titres de sous-section numérotés (3.2.1), 52px au-dessus, 14px dessous; le numéro est à 0.9em.
- **Title** (700, 1.1875rem, 1.2): nom du volume dans le bandeau. Le titre du panneau Partager est à 1.0625rem.
- **Lede** (Literata 400, 1.25rem, 1.55; 1.125rem sous 860px): chapeau sous le titre, en `ink-2`.
- **Body** (Literata 400, 1.125rem, 1.72): prose, colonne de 640 à 720px; ponctuation suspendue, `text-wrap: pretty`. Les explications des repères de code et l'encadré gardent Literata (1rem/1.6 pour les repères).
- **UI** (400, 1rem, 1.5) et **Nav** (0.9375rem, 1.3): base de l'interface, lignes du sommaire, fil d'Ariane, options.
- **Caption** (0.875rem, 1.45): légendes de figures, notes de marge, tableaux OpenAPI.
- **Label** (700, 0.8125rem): intitulés du colophon; métadonnées en 400 à la même taille en `ink-3`. Pas de capitales, pas d'interlettrage.
- **Spine** (700, 0.78rem, vertical): titre du dos, écrit de bas en haut (`writing-mode: vertical-rl` puis rotation 180°).
- **Code** (Mono 400, 0.875rem, 1.7): listings; en ligne à 0.88em, avec fond `desk`, filet et rayon 5px. En-tête de listing, verbes HTTP et codes de réponse en Mono 500 ou 700 à 0.75 à 0.8125rem.

### Named Rules
**La règle des chiffres alignés.** Tout numéro (section, volume, compte, date, code HTTP) est en chiffres tabulaires (`font-variant-numeric: tabular-nums`).

**La règle des deux voix.** Literata pour ce qu'on lit, Atkinson pour ce qu'on manipule ou qui étiquette. Un titre, un bouton ou une légende n'est jamais en Literata; un paragraphe de doc n'est jamais en Atkinson.

## Layout

Grille d'application en deux colonnes: une navigation collante de pleine hauteur (étagère de 64px plus sommaire de 280px) puis la zone principale. La zone principale est un conteneur (`container-type: inline-size`) qui porte le bandeau collant, puis la page (`44px 28px 96px` de padding).

La feuille fait `min(100%, mesure + marge + 28px)`, centrée: colonne de lecture, gouttière de 28px, marge des notes. La mesure suit la place (`clamp(640px, 100cqi - marge - 84px, 720px)`, posée sur `.page`): 640px quand la marge tient tout juste, 720px dès que le conteneur atteint 1036px; au-delà, la ligne de Literata dépasserait 85 signes.

- **Conteneur ≥ 956px:** les notes de marge flottent à droite dans la colonne de 232px (marge négative), et le bloc OpenAPI déborde sur la marge (`.node-openapi`, marge droite négative); une note qui croiserait un bloc large passe dessous.
- **Conteneur ≥ 1240px:** la marge des notes passe à 264px, et les blocs larges avec elle (1012px avec la mesure de 720px).
- **Fenêtre ≤ 1360px (portable):** sommaire réduit à 256px, métadonnées du volume masquées dans le bandeau, écart du bandeau à 14px. Les notes de marge gardent leur colonne.
- **Fenêtre ≤ 860px (mobile):** la navigation devient un tiroir fixe (`min(344px, 88vw)`, `100dvh`) qui glisse depuis la gauche avec un voile `rgba(12, 14, 20, .45)`; une barre supérieure papier (menu, nom court du volume, recherche) apparaît; le bandeau passe sur plusieurs lignes, le fil d'Ariane en pleine largeur, présence masquée; padding de page `28px 20px 72px`; colophon en une colonne; pager en une colonne; poignées d'édition masquées; diagrammes à leur largeur naturelle avec défilement horizontal.

Rythme vertical observé: figures `30px 0 34px`, encadré `28px 0 30px`, colophon 36px dessous, titre de section 52px dessus, bloc « après la page » 60px dessus.

## Elevation & Depth

Le système est plat. Les cadres, listings, blocs OpenAPI, encadrés et cartes du pager se tiennent par un filet de 1px (`rule`) et un fond tonal (`paper`, `desk`, `code-bg`, `vol-tint`), sans ombre. L'ombre est réservée à ce qui quitte le plan de la page, et chaque ombre a son rôle.

### Shadow Vocabulary
- **Tiré** (`box-shadow: 4px 2px 12px rgba(20, 26, 40, .22)`; sombre `4px 2px 14px rgba(0, 0, 0, .6)`): dos survolé ou courant, sorti de l'étagère vers la droite.
- **Carte** (`box-shadow: 0 8px 18px rgba(20, 26, 40, .14), 0 1px 3px rgba(20, 26, 40, .10)`; sombre `0 8px 18px rgba(0, 0, 0, .45), 0 1px 3px rgba(0, 0, 0, .4)`): menu `/` et panneau Partager.
- **Pop** (`box-shadow: 0 14px 36px rgba(20, 26, 40, .16), 0 2px 6px rgba(20, 26, 40, .08)`; sombre `0 14px 36px rgba(0, 0, 0, .5), 0 2px 6px rgba(0, 0, 0, .4)`): tiroir de navigation ouvert sur mobile.

### Named Rules
**La règle du plan.** Une surface posée sur la page n'a pas d'ombre. Seuls un dos tiré, un panneau flottant et le tiroir mobile en portent, et toujours avec une ombre douce et teintée d'encre, jamais un décalage dur.

## Shapes

Des angles doux et constants, sans arrondi gonflé: 6px pour les petites pastilles (verbe HTTP, schéma), 8px pour les contrôles de ligne (nœud du sommaire, menu `/`, panneau Partager, sélecteur de rôle, petit bouton icône), 10px pour les contrôles (recherche, bouton icône, champ, bouton encre, option), 14px pour les grands cadres (figure, listing, OpenAPI, encadré, pager). Les pilules (999px) sont réservées aux éléments posés sur le bandeau (bascule Lire/Modifier, Partager), aux badges (« vous », type de bloc) et aux puces citées; les cercles aux avatars, repères de code et ancres.

Deux formes appartiennent au monde du livre: le **dos** (rayon `4px 6px 6px 4px`, plus arrondi côté tranche, avec deux filets de nervure en haut et un en bas à 55% de `vol-on`) et la **pastille de volume** (14 × 18px, rayon `2px 4px 4px 2px`), un dos miniature. Les signes d'accès sont des carrés de 12px à rayon 3px. Le pointillé (`rule-2`) marque ce qui est en construction ou à ajouter: contours de blocs en édition, bouton « Nouveau volume », zones de diagramme.

## Components

### L'étagère des dos
Une colonne `shelf` de 64px: logo « Appui » (deux dos penchés l'un contre l'autre forment le A, le signet moutarde `#F2B33D` en fait la barre; encre `currentColor`, favicon clair et sombre), dos empilés (écart 6px, retrait gauche 12px), puis « Nouveau volume » (bouton icône 36px à bordure pointillée 1.5px) et l'avatar du compte.
- **Dos:** 38px de large, hauteur propre au volume (`--h`, 124 à 150px dans la maquette), fond `vol`, texte `vol-on`, numéro du volume en haut (700, 0.75rem), titre vertical.
- **Survol:** glisse de 5px vers la droite avec l'ombre Tiré.
- **Courant** (`aria-current="true"`): tiré de 14px, élargi à 42px, ombre Tiré, au-dessus des autres.
- **Mouvement:** transform, ombre et largeur en 0.22s sur la courbe livre `cubic-bezier(.16, 1, .3, 1)`. Cliquer un dos change `data-vol` sur la racine: toute la page reprend la nouvelle toile.

### L'écran de connexion
Deux colonnes (`1.15fr / 1fr`, formulaire d'au moins 420px), pour la connexion, l'invitation et la réinitialisation.
- **Marque** (gauche, collante, pleine hauteur): fond `#161B26` (`#0B0D12` en sombre, filet droit `rule`), logo et nom en 700 1.25rem, titre en Literata 600 `clamp(2rem, 3.1vw, 2.875rem)` « Votre documentation technique, reliée en volumes. », texte `#B3B9C7` qui nomme les trois signes d'accès, puis une étagère de sept dos d'exemple (50px de large, hauteurs propres, toiles du système, nervures du dos) posés sur une planche de 9px; le dernier penche de 8° contre les autres. Les dos montent en place au chargement (0.7s, courbe livre, décalés de 70ms) et se soulèvent de 10px au survol.
- **Formulaire** (droite, papier): colonne de 380px centrée, titre UI 700 2rem.
- **Mobile:** la marque devient un bandeau (nom, titre en 1.5rem, dos réduits à 36% sans titre), le formulaire suit.

### Le sommaire
Colonne `desk` avec filet droit. En tête, la recherche (bouton papier à filet, `ink-3`, raccourci `⌘K` en touche clavier), puis l'en-tête du volume (pastille de volume, nom en 700, « Vol. 3 · 42 pages » en `ink-3`).
- **Nœud:** grille numéro (2.4em; 3em et retrait 20px pour le niveau 2) / titre / zone révélée; 34px minimum, padding `5px 8px`, rayon 8px. Les parents ont numéro et titre en 600.
- **Révélé au survol et au focus:** la zone de droite (signe d'accès de l'utilisateur et fraîcheur « 3 j », « 2 h ») est invisible au repos et apparaît en 0.18s (opacité plus 4px de translation) au survol ou au focus clavier. La page courante et les pages restreintes l'affichent en permanence (cadenas plus signe contour pour une page en lecture seule).
- **Courant:** fond `vol-tint`, texte et numéro `vol-deep`, 600.
- **Pied:** « Nouvelle page », corbeille, réglages, séparés par un filet.

### Le bandeau du volume
Barre collante en haut de la zone principale, fond `vol`, texte `vol-on`, 64px de haut, padding `10px 28px`. Nom du volume et métadonnées, filet vertical à 40% de `vol-on`, fil d'Ariane (page courante en 600), puis à droite: avatars de présence entourés d'un anneau de 2px en `vol`, bascule Lire/Modifier, bouton Partager, bouton de thème.
- **Bascule Lire/Modifier:** pilule à fond `vol-on` 14% et bordure `vol-on` 35%; l'option active est papier sur encre.
- **Bouton papier** (Partager): pilule papier, encre, 600; monte de 1px au survol.
- **Bouton icône sur bandeau:** survol à `vol-on` 16%; le focus y prend un contour `vol-on`.

### Le colophon des droits
Sous le chapeau, entre un filet d'encre (haut, 1px `ink`) et un filet `rule` (bas). Trois colonnes égales Écriture, Commentaire, Lecture: intitulé en Label `ink-2` précédé de son signe en `vol-deep`, puis le groupe en `ink`, le compte en `ink-3` et, si c'est vous, le badge « vous » (pilule `vol-tint`/`vol-deep`). Une ligne de métadonnées sous un filet pointillé: héritage des droits, version et auteur, lien Historique.

### Les signes d'accès
Carré de 12px, rayon 3px, bordure 1.5px en `currentColor`:
- **Plein** = écriture (fond `currentColor`).
- **Hachuré** = commentaire (hachures à 135°, traits de 1.5px tous les 4px).
- **Contour** = lecture (fond transparent).
Ils apparaissent dans le colophon, le sommaire et le sélecteur de rôle du panneau Partager, toujours avec un libellé ou un `aria-label` à côté: la forme distingue, le texte nomme.

### Figures et listings
Chaque bloc technique est une `figure` numérotée par chapitre. Le cadre: filet `rule`, rayon 14px, fond papier, `16px 12px 12px`, débordement horizontal autorisé. La légende: numéro en 700 `vol-deep` (« Figure 3.2 », « Listing 3.1 »), texte en Caption `ink-2`, actions fantômes à droite (Source, Agrandir, Modifier dans draw.io). Les diagrammes s'appellent Figure, le code et les spécifications s'appellent Listing.
- **Bouton fantôme:** `ink-2`, 600, 0.8125rem, rayon 7px; survol `hover` et `ink`.
- **Source:** la source Mermaid se déplie sous la figure dans un `pre` `code-bg` à rayon 10px.

### Code et repères
Listing à filet et rayon 14px sur `code-bg`; en-tête Mono 500 0.75rem `ink-3` (langage) avec bouton Copier, séparé par un filet. Repères dans le code: cercles de 20px, encre pleine, chiffre papier (700, 0.6875rem). Sous la légende, la liste des repères reprend le même cercle dans une grille `28px 1fr`, explications en Literata 1rem/1.6.

### L'encadré
Fond `vol-tint`, rayon 14px, sans bordure; grille icône (1.375rem, `vol-deep`) / contenu; titre « À retenir » en UI 700 0.9375rem `vol-deep`, texte en Literata. La toile teinte l'encadré: il change avec le volume.

### Le bloc OpenAPI
Bloc large (déborde sur la marge à partir de 956px). En-tête `desk` à filet: verbe en Mono 700 sur `ok-tint`/`ok`, route en Mono 500 1rem, résumé `ink-2`, puce de version (Mono 500 0.75rem `ink-3`, filet `rule`, rayon 6px), lien fantôme « Ouvrir dans Redoc » vers l'opération. Corps réglé sur la largeur du bloc lui-même (conteneur `api`), pas sur la fenêtre: deux colonnes `1.25fr / 1fr` séparées par un filet à partir de 720px, sinon paramètres puis réponses l'un sous l'autre. Tableaux des paramètres et des champs: en-têtes `ink-3` 0.75rem, lignes à filet sans cadre (les règles des tableaux de page ne s'y appliquent pas), nom à sa largeur suivi de près du type en Mono `ink-3`, « requis » en `err` 700 0.6875rem; pas de colonne Description quand la spec n'en donne aucune. Réponses: code en Mono 700 sur pastille `ok-tint` ou `err-tint`, schéma JSON sur `code-bg` rayon 6px.
- **Spec vivante:** le bloc relit la spec du volume à l'affichage. Si la spec ou l'opération a disparu, une bande `hl` sous l'en-tête (0.8125rem, icône) annonce « Copie gardée dans la page » et le bloc montre sa dernière copie.
- **En mode Modifier:** un sélecteur « Opération » apparaît sous l'en-tête; la copie gardée suit la spec quand elle a changé.

### La page d'une spec
Bandeau du volume, puis une barre papier collante sous lui (filet bas, `12px 28px`): nom en UI 700 1.25rem, sélecteur de version en Mono 0.8125rem, actions `btn-line sm` à droite (Publier une version, Depuis la CI, Supprimer en icône). « Depuis la CI » déplie la commande `curl` dans un cadre `code-bg` à filet avec un bouton Copier. Redoc prend toute la largeur dessous, sur papier, avec les tokens: polices UI et Mono d'Andal, encre, filets, toile du volume pour les liens et le menu actif; verbes HTTP en tons moyens fixes, lisibles en clair comme en sombre. Son menu se colle sous la barre (`--spec-top`, mesuré). Chargement: un reflet `desk` qui balaie le papier en 1.4s.
- **Dans le sommaire:** « Specs API » sous un filet, intitulé Label `ink-3`; une ligne par spec, icône `ink-3`, nom tronqué, version Mono 0.75rem `ink-3`; courante en `vol-tint`/`vol-deep` 600.

### Jetons, webhooks, synchro Git
- **Jeton tout juste créé:** bande `hl` (0.875rem, icône d'avertissement) « Copiez-le maintenant: il ne sera plus jamais affiché », puis le jeton dans un champ à copier (`linkbox`). Dans la liste, préfixe Mono 0.75rem `ink-3` sous le nom, portée et dernière utilisation.
- **Webhook:** une carte à filet `rule`, rayon `r-l`, `16px 18px`: nom 700 1rem, format en pilule `hover` 700 0.75rem (JSON signé, Slack, Teams), adresse Mono 0.8125rem `ink-2` qui se coupe n'importe où, portée et événements `ink-2`, dernier envoi en `ok` ou `err`. Actions `btn-line` à droite. Un webhook coupé passe sur `desk`, son contenu à 70%. Liste vide: cadre pointillé `rule-2` avec une phrase et le bouton d'ajout.
- **Synchro Git** (réglages du volume): titre avec l'icône de branche, une phrase qui dit quel dossier de quel dépôt tient combien de pages, l'état en `ok` ou `err`, le webhook de la forge replié dans un `details`. Formulaire: dépôt pleine largeur, branche et dossier côte à côte.
- **Page tenue par Git:** au-dessus du titre, une note `desk` à filet, rayon `r`, UI 0.875rem `ink-2`: icône de branche `ink-3`, « Cette page vient de `docs/api/auth.md` », lien 600 « Ouvrir le fichier » sur la forge. Dans le sommaire, la page porte le signe commentaire de qui pourrait sinon l'écrire.

### Aperçus GitHub et Jira
Même `pop` de 360px que l'aperçu de page, en grille à 6px: source en UI 600 0.75rem `ink-3` avec icône (pull request ou tableau), « open226bf/andal #42 » ou « PAY-128 · Bug »; titre 0.9375rem/1.4 `ink`; état en pilule 700 0.75rem précédée d'un point plein: ouvert en `ok-tint`/`ok`, fusionnée en teinte de commande, fermé en `err-tint`/`err`, statut Jira selon sa catégorie. Un lien privé ou injoignable n'ouvre rien: pas de fiche vide.

### L'assistant
Dans ⌘K, une ligne « Demander à l'assistant: … » (icône étincelle, touche `↵` ou `⇧↵`) précède les résultats; Entrée sur une phrase qui finit par « ? », ou Maj + Entrée, l'ouvre. La réponse remplace la liste:
- **En-tête:** icône `vol-deep`, la question en 700 1rem, filet bas.
- **Réponse:** en Literata 1rem/1.62, comme une page (paragraphes, listes à puces, code en ligne `code-bg`). Les citations [1] sont des pastilles `vol-tint`/`vol-deep` 700 0.6875rem qui mènent à la source et s'inversent au survol.
- **Sources:** sous un filet, intitulé Label `ink-3`, une ligne par page citée: numéro de citation en pastille `hover`, numéro de section `vol-deep` tabulaire, titre, volume `ink-3`.
- **Pied:** 0.75rem `ink-3`, sous un filet: le modèle qui a répondu, et le rappel de vérifier dans les pages citées.
- **Administration → Assistant:** une note `desk` à filet qui dit ce qui part au modèle et ce qui n'y part jamais, puis le formulaire (640px max): fournisseur, modèle, adresse, clé (jamais réaffichée), interrupteur, Tester.

### Figures draw.io et Mermaid
Les deux renderers prennent les tokens, pas leur thème par défaut.
- **Mermaid** (thème `base`, Atkinson 14px): acteurs et activations en `vol-tint` bordés de `vol`, lignes `ink-3`, messages `ink-2`, lignes de vie `rule-2`, numéros de séquence en `vol-on`, notes en `hl`/`hl-line`. Rendu à nouveau à chaque changement de volume ou de thème.
- **draw.io** (SVG): zone réseau en pointillé `rule-2` (5/5) avec libellé `ink-3` 600 12px; nœuds papier bordés `ink-2` 1.25px, services en `vol-tint` bordés `vol` 1.5px, stockages en `desk` bordés `ink-3`; texte 600 13px; arêtes `ink-3` 1.5px avec flèches pleines, contrôles en pointillé 4/4, étiquettes 500 11.5px. Rayon des nœuds 8, de la zone 12.
- **Indice de défilement mobile:** sous 860px, les diagrammes gardent leur largeur naturelle (`--nat`, 640px pour draw.io, la largeur rendue pour Mermaid). Quand le cadre déborde, la légende affiche « Faire défiler » (icône flèches, 600, `vol-deep`) et le cadre s'estompe sur 56px côté contenu caché (masque en dégradé à droite, à gauche, ou des deux côtés), mis à jour au défilement et au redimensionnement.

### Images, pièces jointes, tableaux, tâches
- **Image envoyée:** une figure numérotée comme les schémas (« Figure 3.2 »), cadre `frame` sans marge intérieure sur fond `desk`, image contenue (`max-height: 72vh`). Légende éditable et lien « Taille réelle » (ghost); en mode Modifier, un champ « Texte alternatif » souligné en pointillé `rule-2` sous la légende. Image indisponible: message `err` avec l'icône d'image brisée, sans révéler pourquoi.
- **Pièce jointe:** une fiche, pas une figure: grille icône 44px (`vol-tint`, icône `vol-deep` selon le format: PDF, archive, texte, tableur, autre), nom 600 tronqué, « PDF · 1,2 Mo » `ink-3` en chiffres tabulaires, bouton « Télécharger » `btn-line sm`. Bord `rule`, rayon `r-l`.
- **Tableau:** filets `rule` 1px, en-tête sur `desk` en 650, cellules 8/12px, texte .9375rem/1.5; colonnes à la largeur du contenu, redimensionnables (poignée 4px `vol`), sélection de cellules teintée `vol` à 14%. Sur mobile, le tableau défile dans son cadre, jamais la page.
- **Liste de tâches:** la case (17px, `accent-color: vol-deep`) remplace la puce; une tâche faite passe en `ink-3` barrée d'un trait `rule-2`. Libellés accessibles « Fait: … » / « À faire: … ».
- **Liens:** soulignés 1px à `.18em`, couleur `vol-deep`, soulignement à 45% qui se pleine au survol: un lien se repère sans la couleur. Un lien vers une page ouvre au survol (350ms) un aperçu `pop` de 360px: volume (pastille de toile), « 4.1 Runbook incident » (numéro `vol-deep`), trois lignes de résumé en Literata `ink-2`, date `ink-3`. Montée de 4px en 160ms, courbe `cubic-bezier(.16, 1, .3, 1)`.
- **Choisir un lien (⌘K):** la boîte de recherche, une ligne par destination: numéro `vol-deep` et titre de page avec son volume, ou « Lien vers example.com » avec un globe; « Retirer le lien » en pied quand le curseur est sur un lien.
- **Rétroliens:** « Citée dans » (700 .8125rem `ink-3`) au-dessus des pages voisines, une ligne par page: pastille de toile, numéro, titre tronqué, volume à droite s'il diffère.

### Les notes de marge
Les commentaires vivent dans la marge, pas dans des bulles flottantes. Une note: filet haut `rule`, Caption `ink-2`; ligne auteur (avatar 24px, nom 700 `ink`, heure `ink-3` tabulaire, pastille d'ancre numérotée à droite), texte en `ink`, réponses en retrait de 14px derrière un filet gauche, actions fantômes Répondre et Résoudre. La variante discrète (`quiet`) passe le texte en `ink-2`. Le passage commenté est surligné (`hl`, soulignement `hl-line`) et suivi de la même pastille numérotée (17px, `hl-line`, chiffre encre). Sous 956px de conteneur, les notes se placent dans le flux, au-dessus du paragraphe concerné.

### Le panneau Partager
Panneau flottant à droite sous le bandeau (`inset: 72px 20px auto auto`, largeur `min(420px, 100vw - 32px)`; sous 860px, pleine largeur à 16px des bords), papier, filet, rayon 8px, ombre Carte, filet haut de 3px en `vol`. Apparition en 0.18s (opacité et 6px de descente).
- **En-tête:** titre « Partager « 3.2 Authentification » » et bouton fermer.
- **Ajout:** champ papier à filet `rule-2`, rayon 10px (focus: contour 2px `vol-deep`, bordure effacée) et bouton encre « Inviter » (survol: encre mélangée à 15% de papier).
- **Membres:** pastille de groupe 32px `desk` rayon 9px ou avatar 32px, nom et compte, sélecteur de rôle avec signe d'accès en `vol-deep` et chevron.
- **Pied:** interrupteur du lien public (38 × 22px, `rule-2` éteint, `vol` allumé, pouce papier), « Restreindre cette page », et la note qu'une restriction ne fait que réduire les droits.

### L'édition: construction des blocs et menu `/`
En mode Modifier, la page reste la même et montre sa construction:
- chaque bloc reçoit un contour pointillé `rule-2` à 8px de décalage (paragraphes et titres: `rule`, 5px), qui apparaît en 0.22s;
- une poignée de glisser (24 × 28px, rayon 6px, `ink-3`, à 44px à gauche) apparaît, masquée sous 860px;
- les blocs riches portent une étiquette de type en pilule (papier, filet `rule-2`, 600 0.6875rem, icône) au-dessus du coin gauche: Mermaid, Code, Encadré, OpenAPI, draw.io;
- le curseur d'un collaborateur est un trait de 2px avec une étiquette au nom;
- le menu `/`: ligne de saisie en Literata avec le `/` en `vol-deep` et un curseur clignotant (1.1s, par paliers), puis un menu papier de 360px max, rayon 8px, ombre Carte, filet haut de 3px en `vol`. Options en grille icône 34px / libellé et description / raccourci; icône sur `desk` rayon 9px; option active sur `vol-tint`, icône en `vol` sur `vol-on`, libellé `vol-deep`, touche `↵`.

### Navigation secondaire
- **Citée dans:** puces pilules à filet, numéro `ink-3`, survol `desk` et `rule-2`.
- **Pager:** deux cartes à filet et rayon 14px, 600, numéro `vol-deep`; survol bordure `vol` et fond `vol-tint`.
- **Touches clavier** (`kbd`): Mono 500 0.75rem, filet `rule-2` épaissi à 2px en bas, rayon 5px.

### Sécurité du compte
- **Code à usage unique:** champ Mono 500 1.375rem, interlettrage .14em, chiffres tabulaires; clavier numérique et remplissage automatique (`one-time-code`). Le code de secours prend le même champ, en texte.
- **QR code:** carré de 200px à filet `rule`, rayon `r-l`, toujours sombre sur blanc (`#161B26` sur `#FFFFFF`), thème sombre compris: les caméras le lisent mieux. En attendant le secret, le même reflet `desk` que Redoc. La clé à saisir à la main est repliée dessous, groupée par quatre.
- **Codes de secours:** deux colonnes sur `code-bg` à filet, rayon `r`; chaque code en Mono 500 1rem précédé de son rang (01 à 10) en Mono 0.75rem `ink-3`; une colonne sur mobile. Au-dessus, la bande `hl` « Rangez ces codes hors du téléphone ». Copier et Télécharger (.txt) en `btn-line sm`.
- **État:** coche pleine `ok` et « Activée le 3 nov. 2026 »; le nombre de codes restants passe en `err` 600 à trois ou moins.
- **Sessions ouvertes:** liste sous un filet d'encre; une ligne par session en grille icône 36px (`desk`, rayon 10px; `vol-tint`/`vol-deep` pour la session courante) / appareil en 600 avec la pilule « cette session » / Fermer. Dessous, en 0.8125rem `ink-3` tabulaire: mode de connexion, adresse, ouverture, dernière activité.
- **Connexion en deux étapes:** même écran que la connexion; titre « Code de vérification », une phrase `ink-2`, le champ de code, Vérifier, et un lien souligné pour passer au code de secours.

### Administration: comptes, annuaire, journal
- **Pastilles de compte:** « 2 étapes » en `ok-tint`/`ok`, « SCIM » en `hover`/`ink-2`, 700 0.6875rem, à côté du mode de connexion. Un groupe du fournisseur porte la même pastille « SSO » ou « SCIM » à côté de son nom, sans bouton de retrait ni sélecteur d'ajout: il se lit ici et se gère là-bas.
- **Annuaire:** cartes à filet et filet haut d'encre de 2px, comme les groupes, 760px au plus: titre avec icône dans un carré `desk`, état en 0.8125rem, une phrase qui dit quoi faire chez le fournisseur, l'adresse à copier, l'état du jeton (icône `ok`, préfixe Mono, dernier appel).
- **Journal:** filtres dans un bandeau `desk` à filet, rayon `r-l`, contrôles papier de 40px; tableau `roster` à 0.875rem: date tabulaire sans retour à la ligne, personne avec avatar 24px (ou « Annuaire (SCIM) », « Andal » dans un rond `desk`), action en 600, cible soulignée `vol-deep` quand elle mène quelque part, adresse IP en Mono `ink-3`. Les actions sensibles (échecs, levées, retraits, révocations) passent en `err`. « Plus ancien » charge la page suivante; « Exporter en CSV » en `btn-line` dans l'en-tête.
- **Onglets:** six onglets qui défilent horizontalement sur mobile plutôt que de passer à la ligne.

### Enregistrement refusé
Au-dessus du contenu, une bande `err-tint`/`err` (rayon `r`, icône octogone, 0.9375rem/1.5, `role="alert"`) tant que le serveur refuse d'enregistrer la page: elle dit quoi faire (⌘Z) et que rien n'est sauvegardé d'ici là. Seuls ceux qui peuvent écrire la voient; elle part dès que l'enregistrement repasse.

### Mouvement
Une seule courbe, la courbe livre `cubic-bezier(.16, 1, .3, 1)`: rapide au départ, posée à l'arrivée. Durées: 0.15s pour les fonds et couleurs de survol, 0.18s pour les révélations (sommaire, bascule, interrupteur, panneau), 0.22s pour tirer un dos et révéler la construction, 0.26s pour le tiroir mobile. `prefers-reduced-motion: reduce` coupe toutes les animations et transitions.

## Do's and Don'ts

### Do:
- **Do** faire porter toute couleur d'accent par `--vol`, `--vol-on`, `--vol-tint` et `--vol-deep`, posés par `data-vol` sur la racine; un nouveau volume ajoute ses six valeurs, clair et sombre.
- **Do** numéroter: section dans le titre et le sommaire, « Figure n.n » pour un diagramme, « Listing n.n » pour du code ou une spécification, repères numérotés dans le code.
- **Do** écrire le texte coloré sur papier en `vol-deep` et le texte sur toile en `vol-on`.
- **Do** composer la prose en Literata 1.125rem/1.72 sur 640px maximum, et l'interface en Atkinson Hyperlegible Next.
- **Do** montrer les droits avec les trois signes d'accès (plein, hachuré, contour), toujours accompagnés d'un libellé.
- **Do** placer les commentaires dans la marge de 232px à partir de 956px de conteneur, ancrés au texte par une pastille numérotée.
- **Do** passer les diagrammes Mermaid et draw.io par les tokens, et garder leur largeur naturelle sur mobile avec l'indice « Faire défiler » et le fondu de bord.
- **Do** utiliser la courbe `cubic-bezier(.16, 1, .3, 1)` et les durées 0.15 à 0.26s, et respecter `prefers-reduced-motion`.

### Don't:
- **Don't** introduire un accent global de l'application (le wiki gris à accent bleu unique est le contre-modèle); le bleu de Prusse est la toile d'un volume, pas la couleur d'Andal.
- **Don't** écrire du texte en `vol` pleine sur papier: la moutarde y devient illisible.
- **Don't** mettre d'ombre sur une surface posée dans la page (cadre, listing, encadré, carte du pager); l'ombre est réservée au dos tiré, aux panneaux flottants et au tiroir.
- **Don't** utiliser de bulles de commentaire flottantes par-dessus le texte.
- **Don't** reprendre le logo, les icônes ou le nom d'Atlassian.
- **Don't** livrer les polices, les icônes ou Mermaid depuis un CDN dans le produit auto-hébergé.
