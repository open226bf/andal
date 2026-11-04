/**
 * Modèles de page pour les équipes tech: décision d'architecture, RFC,
 * runbook, post-mortem. Écrits en Markdown (voir markdown.ts), dans les deux
 * langues de l'interface; la page créée prend la langue de son auteur.
 */
import type { JSONContent } from './index.js';
import { fromMarkdown } from './markdown.js';

export type TemplateLocale = 'fr' | 'en';
export type TemplateId = 'adr' | 'rfc' | 'runbook' | 'postmortem';

export interface PageTemplate {
  id: TemplateId;
  name: Record<TemplateLocale, string>;
  description: Record<TemplateLocale, string>;
  /** Titre proposé à la création, à remplacer. */
  title: Record<TemplateLocale, string>;
  markdown: Record<TemplateLocale, string>;
}

const ADR_FR = `| Statut | Date | Décideurs |
| --- | --- | --- |
| Proposée | AAAA-MM-JJ | Qui tranche |

## Contexte

Le problème à résoudre et ses contraintes : ce qui est vrai aujourd’hui, sans parler encore de la solution.

## Options envisagées

1. **Option A** : en une phrase, avec son principal avantage et son principal coût.
2. **Option B** : idem.
3. **Ne rien changer** : ce que ça coûte de garder l’existant.

## Décision

Nous retenons l’option … parce que …

## Conséquences

- **Plus simple** : ce que la décision facilite.
- **Plus difficile** : ce qu’elle complique, et ce qu’on accepte de perdre.
- **À surveiller** : le signal qui nous ferait revenir dessus.

> [!NOTE] Une décision acceptée ne se réécrit pas
> Pour en changer, écrivez une nouvelle décision qui la remplace, et passez celle-ci au statut « Remplacée ».
`;

const ADR_EN = `| Status | Date | Deciders |
| --- | --- | --- |
| Proposed | YYYY-MM-DD | Who decides |

## Context

The problem to solve and its constraints: what is true today, before talking about the solution.

## Options considered

1. **Option A**: in one sentence, with its main benefit and its main cost.
2. **Option B**: same.
3. **Change nothing**: what keeping things as they are costs.

## Decision

We choose option … because …

## Consequences

- **Easier**: what the decision makes simpler.
- **Harder**: what it complicates, and what we accept to lose.
- **To watch**: the signal that would make us revisit it.

> [!NOTE] An accepted decision is not rewritten
> To change it, write a new decision that supersedes it, and set this one's status to “Superseded”.
`;

const RFC_FR = `| Auteur | Statut | Relecteurs | Retours attendus avant |
| --- | --- | --- | --- |
| Votre nom | Brouillon | Qui doit relire | AAAA-MM-JJ |

## Résumé

La proposition en trois phrases : quoi, pour qui, et pourquoi maintenant.

## Motivation

Le problème vu par ceux qui le vivent. Des chiffres, des exemples, des tickets.

## Proposition

Le fonctionnement prévu, assez précis pour qu’un relecteur repère ce qui coince : interfaces, données, étapes.

## Alternatives

Ce qu’on a écarté, et pourquoi.

## Risques et inconnues

- [ ] Question encore ouverte
- [ ] Hypothèse à vérifier

## Déploiement

Comment on passe en production, par étapes, et comment on revient en arrière.
`;

const RFC_EN = `| Author | Status | Reviewers | Feedback due |
| --- | --- | --- | --- |
| Your name | Draft | Who should review | YYYY-MM-DD |

## Summary

The proposal in three sentences: what, for whom, and why now.

## Motivation

The problem as the people who live with it see it. Numbers, examples, tickets.

## Proposal

How it will work, precise enough for a reviewer to spot what doesn't fit: interfaces, data, steps.

## Alternatives

What was ruled out, and why.

## Risks and unknowns

- [ ] Question still open
- [ ] Assumption to check

## Rollout

How it reaches production, step by step, and how to roll it back.
`;

const RUNBOOK_FR = `| Service | Astreinte | Tableau de bord | Escalade |
| --- | --- | --- | --- |
| Nom du service | Équipe ou rotation | Lien | Qui appeler ensuite |

> [!WARNING] Avant d’intervenir
> Annoncez l’intervention dans le canal d’incident, et notez l’heure de chaque action.

## Symptômes

L’alerte reçue, et ce que voient les utilisateurs.

## Diagnostic

1. Vérifier l’état du service :

\`\`\`bash
# commande de diagnostic
\`\`\`

2. Lire les derniers journaux d’erreur.
3. Comparer avec le dernier déploiement.

## Remédiation

1. Première action, la moins risquée.
2. Si rien ne change au bout de 10 minutes : action suivante.

## Retour arrière

Comment annuler chaque action de la remédiation.

## Après l’intervention

- [ ] Prévenir les équipes concernées que c’est rétabli
- [ ] Ouvrir un post-mortem si les utilisateurs ont été touchés
`;

const RUNBOOK_EN = `| Service | On call | Dashboard | Escalation |
| --- | --- | --- | --- |
| Service name | Team or rotation | Link | Who to call next |

> [!WARNING] Before you act
> Announce it in the incident channel, and write down the time of each action.

## Symptoms

The alert received, and what users see.

## Diagnosis

1. Check the service status:

\`\`\`bash
# diagnostic command
\`\`\`

2. Read the latest error logs.
3. Compare with the last deployment.

## Remediation

1. First action, the least risky one.
2. If nothing changes after 10 minutes: next action.

## Rollback

How to undo each remediation step.

## Afterwards

- [ ] Tell the affected teams it is resolved
- [ ] Open a post-mortem if users were affected
`;

const POSTMORTEM_FR = `| Date | Durée | Gravité | Impact |
| --- | --- | --- | --- |
| AAAA-MM-JJ | 0 h 00 | Majeure | Qui a été touché, et comment |

> [!NOTE] Sans reproche
> On cherche ce qui, dans le système, a permis l’incident, pas un coupable.

## Résumé

Ce qui s’est passé, en un paragraphe lisible par toute l’entreprise.

## Chronologie

| Heure | Événement |
| --- | --- |
| 09:12 | Première alerte |
| 09:20 | Incident déclaré |
| 10:05 | Service rétabli |

## Cause racine

Pourquoi c’est arrivé, et pourquoi rien ne l’a arrêté plus tôt.

## Ce qui a bien marché

-

## Ce qui a moins bien marché

-

## Actions

- [ ] Action, responsable, échéance
- [ ] Action, responsable, échéance
`;

const POSTMORTEM_EN = `| Date | Duration | Severity | Impact |
| --- | --- | --- | --- |
| YYYY-MM-DD | 0 h 00 | Major | Who was affected, and how |

> [!NOTE] Blameless
> We look for what in the system allowed the incident, not for someone to blame.

## Summary

What happened, in one paragraph anyone in the company can read.

## Timeline

| Time | Event |
| --- | --- |
| 09:12 | First alert |
| 09:20 | Incident declared |
| 10:05 | Service restored |

## Root cause

Why it happened, and why nothing stopped it sooner.

## What went well

-

## What went less well

-

## Action items

- [ ] Action, owner, due date
- [ ] Action, owner, due date
`;

export const PAGE_TEMPLATES: readonly PageTemplate[] = [
  {
    id: 'adr',
    name: { fr: 'Décision d’architecture', en: 'Architecture decision' },
    description: { fr: 'Contexte, options, décision et conséquences (ADR).', en: 'Context, options, decision and consequences (ADR).' },
    title: { fr: 'Décision : ', en: 'Decision: ' },
    markdown: { fr: ADR_FR, en: ADR_EN },
  },
  {
    id: 'rfc',
    name: { fr: 'RFC', en: 'RFC' },
    description: { fr: 'Une proposition à faire relire avant de se lancer.', en: 'A proposal to get reviewed before building it.' },
    title: { fr: 'RFC : ', en: 'RFC: ' },
    markdown: { fr: RFC_FR, en: RFC_EN },
  },
  {
    id: 'runbook',
    name: { fr: 'Runbook', en: 'Runbook' },
    description: { fr: 'Les gestes d’astreinte : symptômes, diagnostic, remédiation.', en: 'On-call steps: symptoms, diagnosis, remediation.' },
    title: { fr: 'Runbook : ', en: 'Runbook: ' },
    markdown: { fr: RUNBOOK_FR, en: RUNBOOK_EN },
  },
  {
    id: 'postmortem',
    name: { fr: 'Post-mortem', en: 'Post-mortem' },
    description: { fr: 'Chronologie, cause racine et actions, sans reproche.', en: 'Timeline, root cause and action items, blameless.' },
    title: { fr: 'Post-mortem : ', en: 'Post-mortem: ' },
    markdown: { fr: POSTMORTEM_FR, en: POSTMORTEM_EN },
  },
];

export function findTemplate(id: string): PageTemplate | null {
  return PAGE_TEMPLATES.find((t) => t.id === id) ?? null;
}

/** Le document d'un modèle, dans la langue demandée. */
export function templateDoc(id: TemplateId, locale: TemplateLocale): JSONContent {
  const template = findTemplate(id);
  if (!template) throw new Error(`Modèle inconnu: ${id}`);
  return fromMarkdown(template.markdown[locale]);
}
