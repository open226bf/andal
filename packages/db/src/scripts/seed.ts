import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { createDb, hashPassword, ltreeLabel, requireEnv, type Cloth } from '../index.js';
import { authenticationPage, simplePage } from './demo-content.js';

/**
 * Jeu de données de démonstration. Efface tout le contenu existant:
 * réservé au développement.
 */

if (process.env.NODE_ENV === 'production') throw new Error('Le seed de démo ne tourne pas en production.');

const db = createDb(requireEnv('DATABASE_URL'), 1);

try {
  await sql`truncate workspaces, users, groups, group_members, rayons, projects, project_members, project_pins, pages, page_restrictions, comment_threads, comments, comment_mentions, notifications, account_tokens cascade`.execute(db);

  const workspaceId = randomUUID();
  await db.insertInto('workspaces').values({ id: workspaceId, name: 'Andal démo' }).execute();

  const users = {
    aminata: { id: randomUUID(), username: 'aminata', name: 'Aminata K.', initials: 'AK', email: 'aminata@andal.test', color: '#F2B33D', workspace_role: 'member' as const },
    thomas: { id: randomUUID(), username: 'thomas', name: 'Thomas R.', initials: 'TR', email: 'thomas@andal.test', color: '#5B4FD6', workspace_role: 'member' as const },
    lea: { id: randomUUID(), username: 'lea', name: 'Léa M.', initials: 'LM', email: 'lea@andal.test', color: '#C2366A', workspace_role: 'member' as const },
    nora: { id: randomUUID(), username: 'nora', name: 'Nora B. (prestataire)', initials: 'NB', email: 'nora@andal.test', color: '#3B6FB6', workspace_role: 'guest' as const },
    camille: { id: randomUUID(), username: 'camille', name: 'Camille D.', initials: 'CD', email: 'camille@andal.test', color: '#157F73', workspace_role: 'owner' as const },
  };
  // Tous les comptes de démo partagent DEMO_PASSWORD (voir .env.example), chacun avec son propre sel.
  const demoPassword = requireEnv('DEMO_PASSWORD');
  const rows = await Promise.all(
    Object.values(users).map(async (u) => ({ ...u, workspace_id: workspaceId, password_hash: await hashPassword(demoPassword), password_changed_at: new Date() })),
  );
  await db.insertInto('users').values(rows).execute();

  const groups = {
    paiements: { id: randomUUID(), name: 'Équipe Paiements', icon: 'users-three' },
    securite: { id: randomUUID(), name: 'Sécurité', icon: 'shield-check' },
    inge: { id: randomUUID(), name: 'Ingénierie', icon: 'buildings' },
  };
  await db.insertInto('groups').values(Object.values(groups).map((g) => ({ ...g, workspace_id: workspaceId }))).execute();
  await db
    .insertInto('group_members')
    .values([
      { group_id: groups.paiements.id, user_id: users.aminata.id },
      { group_id: groups.paiements.id, user_id: users.thomas.id },
      { group_id: groups.securite.id, user_id: users.lea.id },
      { group_id: groups.securite.id, user_id: users.thomas.id },
      { group_id: groups.inge.id, user_id: users.aminata.id },
      { group_id: groups.inge.id, user_id: users.thomas.id },
      { group_id: groups.inge.id, user_id: users.lea.id },
      { group_id: groups.inge.id, user_id: users.camille.id },
    ])
    .execute();

  const projectSpecs: { slug: string; name: string; short: string; cloth: Cloth; volume: number; description: string }[] = [
    { slug: 'identite', name: 'Identité et accès', short: 'Identité', cloth: 'identite', volume: 1, description: 'SSO, comptes et jetons.' },
    { slug: 'plateforme', name: 'Plateforme et infra', short: 'Plateforme', cloth: 'plateforme', volume: 2, description: 'Clusters, réseau et déploiement.' },
    { slug: 'paiements', name: 'Plateforme Paiements', short: 'Paiements', cloth: 'paiements', volume: 3, description: 'API et services de paiement.' },
    { slug: 'mobile', name: 'Application mobile', short: 'App mobile', cloth: 'mobile', volume: 4, description: 'Applications iOS et Android.' },
    { slug: 'donnees', name: 'Données et analytics', short: 'Données', cloth: 'donnees', volume: 5, description: 'Entrepôt, pipelines et tableaux de bord.' },
    // Des volumes que personne n'a épinglés: ils vivent dans la bibliothèque.
    { slug: 'design-system', name: 'Design system', short: 'Design system', cloth: 'design', volume: 6, description: 'Composants, jetons de design et règles d’accessibilité.' },
    { slug: 'observabilite', name: 'Observabilité', short: 'Observabilité', cloth: 'plateforme', volume: 7, description: 'Métriques, traces, alertes et tableaux de suivi.' },
    { slug: 'securite', name: 'Sécurité applicative', short: 'Sécurité', cloth: 'identite', volume: 8, description: 'Revues de sécurité, gestion des secrets, réponse aux incidents.' },
    { slug: 'support', name: 'Support client', short: 'Support', cloth: 'mobile', volume: 9, description: 'Procédures de niveau 2, macros et escalades.' },
    { slug: 'facturation', name: 'Facturation et abonnements', short: 'Facturation', cloth: 'paiements', volume: 10, description: 'Cycle de facturation, relances et rapprochements.' },
    { slug: 'onboarding', name: 'Accueil des nouveaux', short: 'Onboarding', cloth: 'donnees', volume: 11, description: 'Première semaine, accès, outils et contacts.' },
    { slug: 'recherche', name: 'Recherche produit', short: 'Recherche', cloth: 'design', volume: 12, description: 'Entretiens, synthèses et tests d’utilisabilité.' },
  ];
  // Les rayons de la bibliothèque. Données et analytics reste hors rayon, pour la démo.
  const rayonSpecs: { name: string; slugs: string[] }[] = [
    { name: 'Socle technique', slugs: ['plateforme', 'identite', 'observabilite', 'securite'] },
    { name: 'Produits', slugs: ['paiements', 'mobile', 'facturation'] },
    { name: 'Design et recherche', slugs: ['design-system', 'recherche'] },
    { name: 'Équipe', slugs: ['onboarding', 'support'] },
  ];
  const rayonIds = rayonSpecs.map(() => randomUUID());
  await db.insertInto('rayons').values(rayonSpecs.map((r, i) => ({ id: rayonIds[i]!, workspace_id: workspaceId, name: r.name, position: i + 1 }))).execute();
  const rayonOf = (slug: string) => rayonIds[rayonSpecs.findIndex((r) => r.slugs.includes(slug))] ?? null;

  const projects = Object.fromEntries(projectSpecs.map((s) => [s.slug, randomUUID()])) as Record<string, string>;
  await db
    .insertInto('projects')
    .values(projectSpecs.map((s) => ({ id: projects[s.slug]!, workspace_id: workspaceId, slug: s.slug, name: s.name, short_name: s.short, cloth: s.cloth, volume_number: s.volume, description: s.description, rayon_id: rayonOf(s.slug) })))
    .execute();

  const grant = (slug: string, type: 'user' | 'group', id: string, role: 'reader' | 'commenter' | 'editor' | 'admin') => ({
    project_id: projects[slug]!,
    principal_type: type,
    principal_id: id,
    role,
  });
  await db
    .insertInto('project_members')
    .values([
      grant('paiements', 'group', groups.paiements.id, 'editor'),
      grant('paiements', 'group', groups.securite.id, 'commenter'),
      grant('paiements', 'group', groups.inge.id, 'reader'),
      grant('paiements', 'user', users.nora.id, 'reader'),
      grant('identite', 'group', groups.securite.id, 'editor'),
      grant('identite', 'group', groups.inge.id, 'reader'),
      grant('plateforme', 'user', users.lea.id, 'editor'),
      grant('plateforme', 'group', groups.inge.id, 'reader'),
      grant('mobile', 'group', groups.inge.id, 'reader'),
      grant('donnees', 'group', groups.inge.id, 'reader'),
      grant('design-system', 'group', groups.inge.id, 'reader'),
      grant('design-system', 'user', users.lea.id, 'editor'),
      grant('observabilite', 'group', groups.inge.id, 'editor'),
      grant('securite', 'group', groups.securite.id, 'editor'),
      grant('securite', 'group', groups.inge.id, 'reader'),
      grant('support', 'group', groups.inge.id, 'reader'),
      grant('facturation', 'group', groups.paiements.id, 'editor'),
      grant('facturation', 'group', groups.inge.id, 'reader'),
      grant('onboarding', 'group', groups.inge.id, 'commenter'),
      grant('recherche', 'user', users.lea.id, 'admin'),
    ])
    .execute();

  // L'étagère de chacun: les cinq premiers volumes qu'il peut ouvrir; le reste attend dans la bibliothèque.
  const pins = [
    ...['identite', 'plateforme', 'paiements', 'mobile', 'donnees'].flatMap((slug) => [users.aminata, users.thomas, users.lea, users.camille].map((u) => ({ user_id: u.id, project_id: projects[slug]! }))),
    { user_id: users.nora.id, project_id: projects.paiements! },
    { user_id: users.lea.id, project_id: projects.recherche! },
  ];
  await db.insertInto('project_pins').values(pins).execute();

  type Node = { title: string; summary?: string; children?: Node[]; key?: string };
  const keys: Record<string, string> = {};

  async function insertTree(projectSlug: string, nodes: Node[], parent: { id: string; path: string } | null) {
    for (const [index, node] of nodes.entries()) {
      const id = randomUUID();
      const path = parent ? `${parent.path}.${ltreeLabel(id)}` : ltreeLabel(id);
      if (node.key) keys[node.key] = id;
      await db
        .insertInto('pages')
        .values({
          id,
          project_id: projects[projectSlug]!,
          parent_id: parent?.id ?? null,
          path,
          position: index + 1,
          title: node.title,
          summary: node.summary ?? null,
          content: JSON.stringify(simplePage(node.summary ?? `Page « ${node.title} » du volume.`)),
          updated_by: users.aminata.id,
        })
        .execute();
      if (node.children) await insertTree(projectSlug, node.children, { id, path });
    }
  }

  await insertTree('paiements', [
    { title: 'Présentation', summary: "Ce que fait la plateforme Paiements et qui l'exploite." },
    { title: 'Architecture', children: [{ title: "Vue d'ensemble" }, { title: 'Services', key: 'services' }] },
    {
      title: 'API',
      children: [
        { title: 'Conventions' },
        { title: 'Authentification', key: 'auth', summary: "Comment un service client obtient un jeton d'accès pour appeler l'API Paiements, et combien de temps ce jeton reste valable." },
        { title: 'Webhooks', key: 'webhooks' },
        { title: 'Jetons utilisateur' },
      ],
    },
    { title: 'Exploitation', children: [{ title: 'Runbook incident', key: 'runbook' }, { title: 'Astreinte' }] },
    { title: "Décisions d'architecture" },
    { title: 'Glossaire' },
  ], null);
  await insertTree('identite', [{ title: 'Présentation' }, { title: 'SSO OIDC' }, { title: 'Comptes de service' }], null);
  await insertTree('plateforme', [{ title: 'Présentation' }, { title: 'Clusters' }, { title: 'Réseau' }], null);
  await insertTree('mobile', [{ title: 'Présentation' }, { title: 'Publication' }], null);
  await insertTree('donnees', [{ title: 'Présentation' }, { title: 'Entrepôt' }, { title: 'Tableaux de bord' }], null);
  await insertTree('design-system', [{ title: 'Présentation' }, { title: 'Jetons' }, { title: 'Composants', children: [{ title: 'Boutons' }, { title: 'Champs' }] }], null);
  await insertTree('observabilite', [{ title: 'Présentation' }, { title: 'Alertes' }, { title: 'Tableaux de suivi' }], null);
  await insertTree('securite', [{ title: 'Présentation' }, { title: 'Gestion des secrets' }, { title: 'Réponse aux incidents' }], null);
  await insertTree('support', [{ title: 'Présentation' }, { title: 'Escalades' }], null);
  await insertTree('facturation', [{ title: 'Présentation' }, { title: 'Relances' }, { title: 'Rapprochements' }], null);
  await insertTree('onboarding', [{ title: 'Présentation' }, { title: 'Première semaine' }], null);
  await insertTree('recherche', [{ title: 'Présentation' }, { title: 'Entretiens 2026' }], null);
  // Des volumes plus ou moins vivants, pour que « activité récente » veuille dire quelque chose.
  const quiet: Record<string, number> = { identite: 3, plateforme: 1, mobile: 12, donnees: 6, 'design-system': 2, observabilite: 20, securite: 9, support: 45, facturation: 4, onboarding: 90, recherche: 15 };
  for (const [slug, days] of Object.entries(quiet)) {
    await sql`update pages set updated_at = now() - make_interval(days => ${days}) where project_id = ${projects[slug]!}`.execute(db);
  }

  await db
    .insertInto('page_restrictions')
    .values([
      { page_id: keys.runbook!, kind: 'view', principal_type: 'group', principal_id: groups.paiements.id },
      { page_id: keys.webhooks!, kind: 'edit', principal_type: 'user', principal_id: users.thomas.id },
    ])
    .execute();

  const headerThread = randomUUID();
  const storageThread = randomUUID();
  const authContent = authenticationPage({ header: headerThread, storage: storageThread });
  await db.updateTable('pages').set({ content: JSON.stringify(authContent), version: 14 }).where('id', '=', keys.auth!).execute();
  await db
    .insertInto('comment_threads')
    .values([
      { id: headerThread, page_id: keys.auth!, created_by: users.thomas.id },
      { id: storageThread, page_id: keys.auth!, created_by: users.aminata.id },
    ])
    .execute();
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
  const headerComment = randomUUID();
  await db
    .insertInto('comments')
    .values([
      { id: headerComment, thread_id: headerThread, author_id: users.thomas.id, body: '@aminata précisons le format exact: « Bearer », une espace, puis le jeton.', created_at: minutesAgo(25) },
      { thread_id: storageThread, author_id: users.aminata.id, body: 'On parle aussi du jeton de rafraîchissement ici, ou seulement en 3.4 ?', created_at: minutesAgo(120) },
      { thread_id: storageThread, author_id: users.thomas.id, body: "En 3.4: ce flux machine n'en émet pas.", created_at: minutesAgo(60) },
    ])
    .execute();
  // Historique: l'état actuel de chaque page, et pour 3.2 une version 13 de Thomas, d'avant le schéma draw.io.
  await sql`
    insert into page_versions (page_id, version, title, content, authors, created_at, updated_at)
    select id, version, title, content, case when updated_by is null then '[]'::jsonb else jsonb_build_array(updated_by) end, updated_at, updated_at
    from pages
  `.execute(db);
  await db
    .insertInto('page_versions')
    .values({
      page_id: keys.auth!,
      version: 13,
      title: 'Authentification',
      content: JSON.stringify({ ...authContent, content: (authContent.content ?? []).filter((node) => node.type !== 'drawio') }),
      authors: JSON.stringify([users.thomas.id]),
      created_at: minutesAgo(2 * 24 * 60),
      updated_at: minutesAgo(2 * 24 * 60 - 40),
    })
    .execute();

  // Thomas cite Aminata: une notification l'attend à sa première connexion.
  await db.insertInto('comment_mentions').values({ comment_id: headerComment, user_id: users.aminata.id }).execute();
  await db
    .insertInto('notifications')
    .values({ user_id: users.aminata.id, kind: 'mention', actor_id: users.thomas.id, page_id: keys.auth!, thread_id: headerThread, comment_id: headerComment, created_at: minutesAgo(25), emailed_at: minutesAgo(20) })
    .execute();

  console.log(`Données de démo chargées: ${projectSpecs.length} volumes, 5 comptes, 3 groupes.`);
} finally {
  await db.destroy();
}
