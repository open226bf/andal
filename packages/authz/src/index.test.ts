import { describe, expect, it } from 'vitest';
import { archivedRole, assignableRoles, can, canArrangeLibrary, canCreateProject, canDeleteComment, canDeleteProject, canManageAccount, commentRecipients, pageRole, projectRole, type Grant, type Restriction, type Subject } from './index.js';

const aminata: Subject = { userId: 'u-aminata', workspaceRole: 'member', groupIds: ['g-paiements', 'g-inge'] };
const lea: Subject = { userId: 'u-lea', workspaceRole: 'member', groupIds: ['g-securite', 'g-inge'] };
const nora: Subject = { userId: 'u-nora', workspaceRole: 'guest', groupIds: [] };
const camille: Subject = { userId: 'u-camille', workspaceRole: 'admin', groupIds: [] };
const owner: Subject = { userId: 'u-owner', workspaceRole: 'owner', groupIds: [] };

const grants: Grant[] = [
  { principal: { type: 'group', id: 'g-paiements' }, role: 'editor' },
  { principal: { type: 'group', id: 'g-securite' }, role: 'commenter' },
  { principal: { type: 'group', id: 'g-inge' }, role: 'reader' },
];

describe('projectRole', () => {
  it('refuse sans aucun grant', () => {
    expect(projectRole(nora, grants)).toBeNull();
  });

  it('prend le plus haut rôle parmi les grants qui correspondent', () => {
    expect(projectRole(aminata, grants)).toBe('editor');
    expect(projectRole(lea, grants)).toBe('commenter');
  });

  it('donne admin aux admins et propriétaires de l’espace', () => {
    expect(projectRole(camille, [])).toBe('admin');
    expect(projectRole(owner, [])).toBe('admin');
  });

  it('accepte un grant direct pour un invité', () => {
    expect(projectRole(nora, [{ principal: { type: 'user', id: 'u-nora' }, role: 'reader' }])).toBe('reader');
  });

  it('plafonne un invité à éditeur, même par un groupe', () => {
    expect(projectRole(nora, [{ principal: { type: 'user', id: 'u-nora' }, role: 'admin' }])).toBe('editor');
    const inGroup: Subject = { ...nora, groupIds: ['g-paiements'] };
    expect(projectRole(inGroup, [{ principal: { type: 'group', id: 'g-paiements' }, role: 'admin' }])).toBe('editor');
    expect(can(projectRole(inGroup, [{ principal: { type: 'group', id: 'g-paiements' }, role: 'admin' }]), 'project.share')).toBe(false);
  });
});

describe('pageRole', () => {
  const viewOnlyPaiements: Restriction[] = [
    { pageId: 'p-runbook', kind: 'view', principal: { type: 'group', id: 'g-paiements' } },
  ];

  it('retire tout accès hors de la liste d’une restriction en lecture', () => {
    expect(pageRole(lea, grants, viewOnlyPaiements)).toBeNull();
    expect(pageRole(aminata, grants, viewOnlyPaiements)).toBe('editor');
  });

  it('applique la restriction d’un ancêtre aux sous-pages', () => {
    const fromAncestor: Restriction[] = [{ ...viewOnlyPaiements[0]!, pageId: 'p-exploitation' }];
    expect(pageRole(lea, grants, fromAncestor)).toBeNull();
  });

  it('plafonne à commentateur hors de la liste d’une restriction en écriture', () => {
    const editOnlyThomas: Restriction[] = [
      { pageId: 'p-webhooks', kind: 'edit', principal: { type: 'user', id: 'u-thomas' } },
    ];
    expect(pageRole(aminata, grants, editOnlyThomas)).toBe('commenter');
  });

  it('ne fait jamais monter un rôle', () => {
    const editForInge: Restriction[] = [
      { pageId: 'p-x', kind: 'edit', principal: { type: 'group', id: 'g-inge' } },
    ];
    expect(pageRole(lea, grants, editForInge)).toBe('commenter');
  });

  it('exige d’appartenir à chaque restriction de la chaîne', () => {
    const chain: Restriction[] = [
      { pageId: 'p-parent', kind: 'view', principal: { type: 'group', id: 'g-inge' } },
      { pageId: 'p-child', kind: 'view', principal: { type: 'group', id: 'g-paiements' } },
    ];
    expect(pageRole(aminata, grants, chain)).toBe('editor');
    expect(pageRole(lea, grants, chain)).toBeNull();
  });

  it('laisse passer le propriétaire de l’espace', () => {
    expect(pageRole(owner, [], viewOnlyPaiements)).toBe('admin');
  });

  it('applique les restrictions aux admins de l’espace', () => {
    expect(pageRole(camille, [], viewOnlyPaiements)).toBeNull();
  });
});

describe('can', () => {
  it('refuse tout sans rôle', () => {
    expect(can(null, 'page.read')).toBe(false);
  });

  it('suit la matrice des rôles', () => {
    expect(can('reader', 'page.comment')).toBe(false);
    expect(can('commenter', 'page.comment')).toBe(true);
    expect(can('commenter', 'page.edit')).toBe(false);
    expect(can('editor', 'page.edit')).toBe(true);
    expect(can('editor', 'project.share')).toBe(false);
    expect(can('admin', 'project.share')).toBe(true);
  });
});

describe('comptes', () => {
  const as = (userId: string, role: Subject['workspaceRole']) => ({ userId, role });

  it("un propriétaire peut tout attribuer, un admin jamais le rôle de propriétaire", () => {
    expect(assignableRoles('owner')).toContain('owner');
    expect(assignableRoles('admin')).toEqual(['admin', 'member', 'guest']);
    expect(assignableRoles('member')).toEqual([]);
  });

  it('personne ne se gère soi-même', () => {
    expect(canManageAccount(as('u1', 'owner'), as('u1', 'owner'))).toBe(false);
  });

  it("un admin gère les membres et les autres admins, pas les propriétaires", () => {
    expect(canManageAccount(as('a', 'admin'), as('m', 'member'))).toBe(true);
    expect(canManageAccount(as('a', 'admin'), as('b', 'admin'))).toBe(true);
    expect(canManageAccount(as('a', 'admin'), as('o', 'owner'))).toBe(false);
    expect(canManageAccount(as('o', 'owner'), as('p', 'owner'))).toBe(true);
  });

  it('un membre ne gère personne', () => {
    expect(canManageAccount(as('m', 'member'), as('g', 'guest'))).toBe(false);
  });
});

describe('commentaires', () => {
  it("l'auteur supprime le sien, un admin du volume modère, les autres non", () => {
    expect(canDeleteComment('commenter', true)).toBe(true);
    expect(canDeleteComment('editor', false)).toBe(false);
    expect(canDeleteComment('admin', false)).toBe(true);
    expect(canDeleteComment(null, true)).toBe(false);
  });
});

describe('notifications', () => {
  const everyone = () => true;

  it('prévient les personnes citées, puis les participants, sans doublon ni auteur', () => {
    const out = commentRecipients({ authorId: 'a', mentioned: ['b', 'a'], participants: ['b', 'c', 'a', 'c'] }, everyone);
    expect(out).toEqual([
      { userId: 'b', kind: 'mention' },
      { userId: 'c', kind: 'reply' },
    ]);
  });

  it('ne prévient pas qui ne peut pas lire la page', () => {
    const out = commentRecipients({ authorId: 'a', mentioned: ['secret'], participants: ['secret', 'c'] }, (id) => id !== 'secret');
    expect(out).toEqual([{ userId: 'c', kind: 'reply' }]);
  });
});

describe('volumes', () => {
  it('un volume archivé se lit mais ne s’écrit plus, même pour un admin', () => {
    expect(archivedRole('admin', true)).toBe('reader');
    expect(archivedRole('editor', true)).toBe('reader');
    expect(archivedRole('editor', false)).toBe('editor');
    expect(archivedRole(null, true)).toBeNull();
  });

  it('les membres créent des volumes, pas les invités', () => {
    expect(canCreateProject(aminata)).toBe(true);
    expect(canCreateProject(nora)).toBe(false);
    expect(canCreateProject(aminata, false)).toBe(false);
    expect(canCreateProject(camille, false)).toBe(true);
  });

  it('seuls les admins de l’espace rangent la bibliothèque', () => {
    expect(canArrangeLibrary('owner')).toBe(true);
    expect(canArrangeLibrary('admin')).toBe(true);
    expect(canArrangeLibrary('member')).toBe(false);
    expect(canArrangeLibrary('guest')).toBe(false);
  });

  it('seuls les admins de l’espace suppriment un volume', () => {
    expect(canDeleteProject(owner)).toBe(true);
    expect(canDeleteProject(camille)).toBe(true);
    expect(canDeleteProject(aminata)).toBe(false);
  });
});
