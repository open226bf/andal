import type { WorkspaceRole } from '@andal/authz';
import { sql } from 'kysely';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { createDb, EMAIL_PATTERN, hashPassword, initialsOf, passwordProblem, profileColor, requireEnv, suggestUsername, USERNAME_PATTERN } from '../index.js';

/**
 * Comptes locaux en ligne de commande, en attendant l'écran d'administration.
 *
 *   pnpm user:add                      crée un compte (le premier devient propriétaire)
 *   pnpm user:password <email|login>   définit un nouveau mot de passe
 *
 * Le mot de passe se tape sans écho. Hors terminal, les réponses sont lues
 * ligne par ligne sur l'entrée standard.
 */

const ROLES: WorkspaceRole[] = ['owner', 'admin', 'member', 'guest'];

let muted = false;
const output = new Writable({
  write(chunk, encoding, callback) {
    if (!muted) stdout.write(chunk, encoding);
    callback();
  },
});
const rl = createInterface({ input: stdin, output, terminal: stdin.isTTY });

// File de lignes: hors terminal, toute l'entrée arrive d'un coup, avant les questions.
const queue: string[] = [];
const waiting: ((line: string | null) => void)[] = [];
let ended = false;
rl.on('line', (line) => {
  const take = waiting.shift();
  if (take) take(line);
  else queue.push(line);
});
rl.on('close', () => {
  ended = true;
  for (const take of waiting.splice(0)) take(null);
});

function readLine(prompt: string, secret: boolean): Promise<string> {
  stdout.write(prompt);
  muted = secret;
  return new Promise((resolve, reject) => {
    const take = (line: string | null) => {
      muted = false;
      if (secret || !stdin.isTTY) stdout.write('\n');
      if (line === null) reject(new Error('Entrée interrompue.'));
      else resolve(line);
    };
    if (queue.length > 0) take(queue.shift()!);
    else if (ended) take(null);
    else waiting.push(take);
  });
}

async function ask(question: string, fallback = ''): Promise<string> {
  const answer = (await readLine(fallback ? `${question} [${fallback}] ` : `${question} `, false)).trim();
  return answer || fallback;
}

function askSecret(question: string): Promise<string> {
  return readLine(`${question} `, true);
}

async function newPassword(identity: { email: string; username: string | null }): Promise<string> {
  for (;;) {
    const password = await askSecret('Mot de passe:');
    const problem = passwordProblem(password, identity);
    if (problem) {
      console.error(problem);
      continue;
    }
    if ((await askSecret('Confirmez:')) === password) return password;
    console.error('Les deux saisies diffèrent.');
  }
}

const db = createDb(requireEnv('DATABASE_URL'), 1);
const [command, target] = process.argv.slice(2);

try {
  if (command === 'add') {
    let workspace = await db.selectFrom('workspaces').select(['id', 'name']).orderBy('created_at').executeTakeFirst();
    if (!workspace) {
      const name = await ask("Nom de l'espace:", 'Andal');
      workspace = await db.insertInto('workspaces').values({ name }).returning(['id', 'name']).executeTakeFirstOrThrow();
    }
    const count = Number((await db.selectFrom('users').select(sql<string>`count(*)`.as('n')).where('workspace_id', '=', workspace.id).executeTakeFirstOrThrow()).n);

    const email = (await ask('Email:')).toLowerCase();
    if (!EMAIL_PATTERN.test(email)) throw new Error('Email invalide.');
    const name = await ask('Nom affiché:');
    if (!name) throw new Error('Nom requis.');
    const username = (await ask('Identifiant de connexion:', suggestUsername(email))).toLowerCase();
    if (!USERNAME_PATTERN.test(username)) throw new Error('Identifiant: 2 à 40 caractères parmi a-z, 0-9, point, tiret, souligné.');
    const role = (await ask(`Rôle (${ROLES.join(', ')}):`, count === 0 ? 'owner' : 'member')) as WorkspaceRole;
    if (!ROLES.includes(role)) throw new Error('Rôle inconnu.');
    const password = await newPassword({ email, username });

    await db
      .insertInto('users')
      .values({
        workspace_id: workspace.id,
        email,
        username,
        name,
        initials: initialsOf(name),
        color: profileColor(count),
        workspace_role: role,
        password_hash: await hashPassword(password),
        password_changed_at: new Date(),
      })
      .execute();
    console.log(`Compte créé: ${username} (${role}) dans « ${workspace.name} ».`);
  } else if (command === 'password' && target) {
    const login = target.toLowerCase();
    const user = await db
      .selectFrom('users')
      .select(['id', 'email', 'username'])
      .where((eb) => eb.or([eb(sql`lower(email)`, '=', login), eb(sql`lower(username)`, '=', login)]))
      .executeTakeFirst();
    if (!user) throw new Error(`Aucun compte pour « ${target} ».`);
    const password = await newPassword(user);
    await db.updateTable('users').set({ password_hash: await hashPassword(password), password_changed_at: new Date() }).where('id', '=', user.id).execute();
    console.log('Mot de passe mis à jour. Les sessions ouvertes avec ce compte sont fermées.');
  } else {
    console.error('Usage: user.ts add | user.ts password <email|identifiant>');
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  rl.close();
  await db.destroy();
}
