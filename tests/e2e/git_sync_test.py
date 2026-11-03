"""Synchro Git → volume (docs-as-code): arbre, titres, liens relatifs, images, blocs OpenAPI, verrou d'écriture, webhook « push », retrait des fichiers."""
import base64
import hashlib
import hmac
import json
import os
import subprocess
import tempfile
import time

from harness import Client, check, finish, login, msg, sql

PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==')

repo = tempfile.mkdtemp(prefix='andal-docs-')


def git(*args):
    subprocess.run(['git', '-C', repo, *args], check=True, capture_output=True, env={**os.environ, 'GIT_AUTHOR_NAME': 'CI', 'GIT_AUTHOR_EMAIL': 'ci@exemple.org', 'GIT_COMMITTER_NAME': 'CI', 'GIT_COMMITTER_EMAIL': 'ci@exemple.org'})


def write(path, content):
    full = os.path.join(repo, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, 'wb') as f:
        f.write(content if isinstance(content, bytes) else content.encode())


git('init', '-q', '-b', 'main')
write('README.md', '# Projet\n\nHors du dossier synchronisé.\n')
write('docs/01-demarrer.md', '---\ntitle: Démarrer\n---\n\nInstaller le client, puis lire [l’authentification](api/auth.md) et [la topologie](./schemas/reseau.md#vue).\n\n![Topologie](img/reseau.png "Le réseau")\n')
write('docs/api/README.md', '# API publique\n\nLes routes de l’API Paiements.\n')
write('docs/api/auth.md', '# Authentification\n\n```openapi\nspec: paiements\noperation: POST /oauth/token\n```\n\n- [ ] Faire tourner les secrets\n')
write('docs/schemas/reseau.md', '# Réseau\n\n```mermaid\nflowchart LR\n  A --> B\n```\n')
write('docs/img/reseau.png', PNG)
git('add', '-A')
git('commit', '-q', '-m', 'docs: première version')

camille = login('camille')  # propriétaire de l'espace: admin du volume
aminata = login('aminata')  # éditrice de Paiements
nora = login('nora')  # lectrice de Paiements
_, shelf = camille.call('GET', '/projects')
paiements = next(p['id'] for p in shelf if p['slug'] == 'paiements')


def wait_sync(previous=None, seconds=25):
    end = time.time() + seconds
    while time.time() < end:
        _, state = camille.call('GET', f'/projects/{paiements}/git')
        if state.get('lastSyncedAt') and state.get('lastSyncedAt') != previous:
            return state
        time.sleep(0.5)
    return state


def git_pages():
    rows = sql(f"select git_path, id, title, parent_id, coalesce(deleted_at::text, '') from pages where project_id = '{paiements}' and git_sync_id is not null order by git_path")
    return {r.split('|')[0]: r.split('|') for r in rows.splitlines() if r}


print('— Réglage')
status, _ = aminata.call('PUT', f'/projects/{paiements}/git', {'repoUrl': f'file://{repo}'})
check('réservé aux admins du volume (403)', status == 403, status)
status, body = camille.call('PUT', f'/projects/{paiements}/git', {'repoUrl': 'git@github.com:equipe/docs.git'})
check('une adresse non https est refusée', status == 400, (status, msg(body)))
status, body = camille.call('PUT', f'/projects/{paiements}/git', {'repoUrl': 'https://github.com/equipe/docs.git', 'path': '../..'})
check('un dossier hors du dépôt est refusé', status == 400, (status, msg(body)))
status, body = camille.call('PUT', f'/projects/{paiements}/git', {'repoUrl': 'https://github.com/equipe/docs.git', 'branch': '--upload-pack=touch /tmp/x'})
check('une branche qui ressemble à une option est refusée', status == 400, (status, msg(body)))
token_client = Client()
_, tok = camille.call('POST', '/me/tokens', {'name': 'x', 'scope': 'write'})
status, _ = token_client.call('GET', f'/projects/{paiements}/git', headers={'authorization': f"Bearer {tok['token']}"})
check('la configuration est réservée à une session (403 avec un jeton)', status == 403, status)
status, state = camille.call('PUT', f'/projects/{paiements}/git', {'repoUrl': f'file://{repo}', 'branch': 'main', 'path': 'docs', 'token': 'jeton-de-lecture'})
check('le volume est relié au dépôt', status == 200 and state['configured'] and state['hasToken'] and 'token' not in json.dumps(state).replace('hasToken', ''), state)
state = wait_sync()
check('la première synchro passe', state.get('lastCommit') and not state.get('lastError'), state)

print('— Arbre et contenu')
pages = git_pages()
check('un fichier = une page, un dossier = une page parente', set(pages) == {'01-demarrer.md', 'api', 'api/auth.md', 'schemas', 'schemas/reseau.md'}, list(pages))
check('titres: en-tête YAML, premier titre, nom de dossier', pages['01-demarrer.md'][2] == 'Démarrer' and pages['api'][2] == 'API publique' and pages['schemas'][2] == 'Schemas', [p[2] for p in pages.values()])
check('la hiérarchie suit les dossiers', pages['api/auth.md'][3] == pages['api'][1] and pages['schemas/reseau.md'][3] == pages['schemas'][1])
check('README.md hors du dossier est ignoré', 'README.md' not in pages)
time.sleep(1)
start = json.loads(sql(f"select content from pages where id = '{pages['01-demarrer.md'][1]}'"))
links = [m['attrs']['href'] for n in start['content'] for c in n.get('content', []) for m in c.get('marks', []) if m['type'] == 'link']
check('les liens relatifs deviennent des liens entre pages', links == [f"/p/{pages['api/auth.md'][1]}", f"/p/{pages['schemas/reseau.md'][1]}"], links)
image = next((n for n in start['content'] if n['type'] == 'image'), None)
check("l'image du dépôt devient une pièce jointe de la page", image is not None and image['attrs']['caption'] == 'Le réseau' and sql(f"select count(*) from attachments where id = '{image['attrs']['fileId']}' and page_id = '{pages['01-demarrer.md'][1]}'") == '1', image)
auth = json.loads(sql(f"select content from pages where id = '{pages['api/auth.md'][1]}'"))
block = auth['content'][0]
check('le bloc OpenAPI est relié à la spec du volume', block['type'] == 'openapi' and block['attrs']['specId'] and block['attrs']['operation']['path'] == '/oauth/token', block['attrs'])
check('le premier titre identique au titre de page est retiré du contenu', auth['content'][0]['type'] == 'openapi')
_, detail = nora.call('GET', f"/pages/{pages['api/auth.md'][1]}")
check('la page dit d’où elle vient', detail['git'] and detail['git']['file'] == 'docs/api/auth.md' and detail['role'] == 'reader', detail.get('git'))
_, tree = aminata.call('GET', '/projects/paiements/tree')
mine = next(p for p in tree['pages'] if p['id'] == pages['api/auth.md'][1])
check('dans le sommaire: marquée Git, en commentaire pour une éditrice', mine['git'] and mine['role'] == 'commenter', mine)

print('— Verrou')
status, body = aminata.call('PUT', f"/pages/{pages['api/auth.md'][1]}/content", {'markdown': 'x'})
check('écrire une page tenue par Git est refusé, avec la raison', status == 403 and 'dépôt Git' in msg(body), (status, msg(body)))
status, _ = aminata.call('PATCH', f"/pages/{pages['api/auth.md'][1]}", {'title': 'Autre'})
check('la renommer aussi', status == 403, status)
status, _ = aminata.call('DELETE', f"/pages/{pages['api/auth.md'][1]}")
check('la mettre à la corbeille aussi', status == 403, status)

print('— Push et webhook')
write('docs/api/auth.md', '# Authentification\n\nJetons valables 15 minutes.\n')
os.remove(os.path.join(repo, 'docs/schemas/reseau.md'))
git('add', '-A')
git('commit', '-q', '-m', 'docs: jetons, retrait du réseau')
_, state = camille.call('GET', f'/projects/{paiements}/git')
body = json.dumps({'ref': 'refs/heads/main'}).encode()
api = Client()
status, _, _ = api.raw('POST', f"/git/hooks/{state['webhookUrl'].rsplit('/', 1)[1]}", body, {'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + '0' * 64, 'x-github-event': 'push'})
check('une signature fausse est refusée (401)', status == 401, status)
signature = 'sha256=' + hmac.new(state['webhookSecret'].encode(), body, hashlib.sha256).hexdigest()
previous = state['lastSyncedAt']
status, _, raw = api.raw('POST', f"/git/hooks/{state['webhookUrl'].rsplit('/', 1)[1]}", body, {'content-type': 'application/json', 'x-hub-signature-256': signature, 'x-github-event': 'push'})
check('le push signé de GitHub déclenche une synchro', status == 202 and json.loads(raw)['queued'], (status, raw))
state = wait_sync(previous)
pages = git_pages()
auth_text = sql(f"select content::text from pages where id = '{pages['api/auth.md'][1]}'")
check('le contenu modifié dans le dépôt arrive dans la page', '15 minutes' in auth_text and 'openapi' not in auth_text, auth_text[:160])
check('le fichier retiré met sa page à la corbeille', pages['schemas/reseau.md'][4] != '' and pages['api/auth.md'][4] == '', [(k, v[4]) for k, v in pages.items()])
versions = sql(f"select count(*) from page_versions where page_id = '{pages['api/auth.md'][1]}'")
check("l'historique garde la version d'avant", int(versions) >= 2, versions)
status, _, raw = api.raw('POST', f"/git/hooks/{state['webhookUrl'].rsplit('/', 1)[1]}", body, {'content-type': 'application/json', 'x-gitlab-token': state['webhookSecret']})
check('GitLab (X-Gitlab-Token) aussi', status == 202, status)

print('— Détacher')
status, _ = camille.call('DELETE', f'/projects/{paiements}/git')
check('le volume se détache du dépôt', status == 204, status)
status, _ = aminata.call('PATCH', f"/pages/{pages['api/auth.md'][1]}", {'title': 'Authentification (reprise)'})
check('les pages restent, et redeviennent modifiables', status == 204, status)

finish()
