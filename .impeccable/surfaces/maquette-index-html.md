---
version: 1
slug: "maquette-index-html"
primary_target: "maquette/index.html"
related_targets: []
---

Scope: maquette de l'écran « Page de doc » d'Andal (nom provisoire). Mode: operate, avec typographie de lecture longue.
Audience: équipes tech (devs, archis, ops) qui lisent et écrivent leur doc technique. Tâche: lire une page, naviguer dans l'arbre, voir qui peut lire ou modifier, passer en édition.
Succès: lecture confortable, navigation rapide, droits lisibles, blocs Mermaid / OpenAPI / draw.io aussi soignés que le texte. À éviter: enfantin, dense, vide.
Contraintes: React, Tailwind, Radix plus tard; la maquette est un prototype HTML/CSS. Aucune donnée réelle: tout le contenu est fictif.
Non décidé: nom définitif, mode sombre par défaut ou non.

## Direction contract

THESIS: chaque projet est un volume relié, chaque page une section numérotée d'un livre technique. Refuse le wiki gris à accent bleu unique.
OWN-WORLD: papier blanc froid, encre bleu-noir, toiles de reliure saturées par projet (tomate, sarcelle, indigo, moutarde, framboise). Dos de livres verticaux, bandeau de couverture, figures et listings numérotés avec légende, colophon des droits, notes en marge. Atkinson Hyperlegible Next pour l'interface, Literata pour la prose, Atkinson Hyperlegible Mono pour le code.
STORY: le lecteur sait où il est (volume, section), qui peut lire ou écrire (signe plein, hachuré, contour), lit sans fatigue, puis bascule en édition.
FIRST VIEWPORT: étagère de dos à gauche, sommaire numéroté, bandeau du volume en haut de la page, titre 3.2, colophon des droits, prose, figure Mermaid; commentaires dans la marge droite; Lire/Modifier et Partager en haut à droite.
FORM: Édition technique (O'Reilly, No Starch, Pragmatic, RFC), position 5 sur 7 de ma liste, seed 6ed69ba8. Interaction signature: tirer un dos de l'étagère pour changer de volume; le mode édition révèle la construction des blocs.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
