"""API publique: jetons personnels, contenu des pages (JSON, Markdown), webhooks signés vers un récepteur local, aperçus GitHub/Jira."""
import hashlib
import hmac
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import quote

from harness import Client, bull, check, finish, login, msg, sql

# --- Récepteur de webhooks sur 127.0.0.1 (WEBHOOK_ALLOW_PRIVATE=true en dev) ---
received = []


class Receiver(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('content-length', 0)))
        received.append({'path': self.path, 'headers': {k.lower(): v for k, v in self.headers.items()}, 'body': body})
        self.send_response(500 if self.path == '/panne' else 200)
        self.end_headers()

    def log_message(self, *args):
        pass


server = ThreadingHTTPServer(('127.0.0.1', 0), Receiver)
threading.Thread(target=server.serve_forever, daemon=True).start()
HOOK = f'http://127.0.0.1:{server.server_address[1]}'


def wait_for(predicate, seconds=12):
    end = time.time() + seconds
    while time.time() < end:
        found = [r for r in received if predicate(r)]
        if found:
            return found[0]
        time.sleep(0.3)
    return None


def event_of(r):
    try:
        return json.loads(r['body']).get('event')
    except ValueError:
        return None


def bearer(token):
    return {'authorization': f'Bearer {token}'}


aminata = login('aminata')  # éditrice de Paiements
nora = login('nora')  # lectrice de Paiements, rien sur Plateforme
camille = login('camille')  # propriétaire de l'espace

_, shelf = aminata.call('GET', '/projects')
paiements = next(p['id'] for p in shelf if p['slug'] == 'paiements')
_, tree = aminata.call('GET', '/projects/paiements/tree')
auth_page = next(p['id'] for p in tree['pages'] if p['title'] == 'Authentification')
runbook = next(p['id'] for p in tree['pages'] if p['title'] == 'Runbook incident')
glossary = next(p['id'] for p in tree['pages'] if p['title'] == 'Glossaire')
_, plateforme_tree = camille.call('GET', '/projects/plateforme/tree')
plateforme_page = plateforme_tree['pages'][0]['id']

print('— Jetons personnels')
status, body = aminata.call('POST', '/me/tokens', {'name': '', 'scope': 'write'})
check('un jeton sans nom est refusé', status == 400, (status, msg(body)))
status, body = aminata.call('POST', '/me/tokens', {'name': 'x', 'scope': 'admin'})
check('une portée inconnue est refusée', status == 400, (status, msg(body)))
status, created = aminata.call('POST', '/me/tokens', {'name': 'CI specs', 'scope': 'write', 'expiresInDays': 90})
write_token = created.get('token', '') if isinstance(created, dict) else ''
check("le jeton n'est montré qu'à sa création", status == 201 and write_token.startswith('andal_') and len(write_token) > 40, status)
status, listing = aminata.call('GET', '/me/tokens')
check('la liste ne montre que le début du jeton', status == 200 and listing[0]['prefix'] == write_token[:12] and 'token' not in listing[0], listing)
check("seule l'empreinte est stockée", sql(f"select count(*) from api_tokens where token_hash = '{hashlib.sha256(write_token.encode()).hexdigest()}'") == '1')
_, read_created = aminata.call('POST', '/me/tokens', {'name': 'Lecture', 'scope': 'read'})
read_token = read_created['token']
_, nora_created = nora.call('POST', '/me/tokens', {'name': 'Nora', 'scope': 'write'})
nora_token = nora_created['token']

api = Client()
status, projects = api.call('GET', '/projects', headers=bearer(write_token))
check('le jeton ouvre les volumes de son auteur', status == 200 and any(p['slug'] == 'paiements' for p in projects), status)
status, me = api.call('GET', '/me', headers=bearer(write_token))
check('…au nom de son auteur', status == 200 and me['user']['name'].startswith('Aminata') and me['auth']['method'] == 'token', me)
status, _ = api.call('GET', '/projects', headers=bearer('andal_faux'))
check('un jeton inconnu: 401', status == 401, status)
status, _ = api.call('GET', '/me/tokens', headers=bearer(write_token))
check('un jeton ne gère pas les jetons (403)', status == 403, status)
status, _ = api.call('GET', '/admin/accounts', headers=bearer(write_token))
check("ni l'administration (403)", status == 403, status)
status, _ = api.call('POST', '/auth/password', {'current': 'x', 'next': 'y'}, headers=bearer(write_token))
check('ni le mot de passe (403)', status == 403, status)
status, _ = api.call('PUT', f'/pages/{auth_page}/content', {'markdown': 'x'}, headers=bearer(read_token))
check('un jeton en lecture seule n’écrit pas (403)', status == 403, status)
status, _ = api.call('GET', f'/pages/{plateforme_page}/content', headers=bearer(nora_token))
check('les droits de l’auteur s’appliquent: page fermée, 404', status == 404, status)
check("la dernière utilisation est notée", sql(f"select count(*) from api_tokens where last_used_at is not null and name = 'CI specs'") == '1')

print('— Contenu des pages')
status, doc = api.call('GET', f'/pages/{auth_page}/content', headers=bearer(read_token))
check('lecture en JSON', status == 200 and doc['content']['type'] == 'doc' and doc['title'] == 'Authentification', status)
status, headers, raw = api.raw('GET', f'/pages/{auth_page}/content?format=markdown', headers=bearer(read_token))
markdown = raw.decode()
check('lecture en Markdown', status == 200 and headers['content-type'].startswith('text/markdown') and markdown.startswith('# Authentification') and '```mermaid' in markdown and '```openapi' in markdown and '| Code |' in markdown, markdown[:200])
versions_before = int(sql(f"select count(*) from page_versions where page_id = '{glossary}'"))
status, _, raw = api.raw('PUT', f'/pages/{glossary}/content', '# Glossaire\n\n## Termes\n\n- **Jeton**: preuve d’accès, 15 minutes.\n- [ ] Ajouter « idempotence »\n'.encode(), {**bearer(write_token), 'content-type': 'text/markdown'})
check('écriture en Markdown brut', status == 200 and json.loads(raw)['updated'] is True, (status, raw[:200]))
time.sleep(2.5)
content = json.loads(sql(f"select content from pages where id = '{glossary}'"))
check('le document est enregistré par le serveur collab', [n['type'] for n in content['content']] == ['heading', 'bulletList'] and content['content'][0]['content'][0]['text'] == 'Termes', content)
check("l'historique garde une version au nom de l'auteur", int(sql(f"select count(*) from page_versions where page_id = '{glossary}'")) == versions_before + 1)
status, again = api.call('PUT', f'/pages/{glossary}/content', {'markdown': '## Termes\n\n- **Jeton**: preuve d’accès, 15 minutes.\n- [ ] Ajouter « idempotence »\n'}, headers=bearer(write_token))
check('réécrire le même contenu ne change rien', status == 200 and again['updated'] is False, again)
status, body = api.call('PUT', f'/pages/{glossary}/content', {'content': {'type': 'doc', 'content': [{'type': 'script', 'text': 'x'}]}}, headers=bearer(write_token))
check('un document hors schéma est refusé', status == 400 and 'schéma' in msg(body), (status, msg(body)))
status, _ = api.call('PUT', f'/pages/{glossary}/content', {'markdown': 'x'}, headers=bearer(nora_token))
check('une lectrice ne peut pas écrire (404)', status == 404, status)
audit = sql("select metadata->>'via' from audit_events where action = 'page.content_replaced' order by created_at desc limit 1")
check('le journal note l’écriture par jeton', audit == 'token', audit)
status, new_page = api.call('POST', f'/projects/{paiements}/pages', {'title': 'Exemple d’appel', 'markdown': '```openapi title="Le jeton"\nspec: paiements\noperation: POST /oauth/token\n```\n'}, headers=bearer(write_token))
check('création d’une page avec son contenu', status == 201, (status, new_page))
stored = json.loads(sql(f"select content from pages where id = '{new_page['id']}'"))
block = stored['content'][0]
check('le bloc OpenAPI est relié à la spec du volume', block['type'] == 'openapi' and block['attrs']['specId'] and block['attrs']['operation']['path'] == '/oauth/token', block)

print('— Webhooks')
status, _ = aminata.call('GET', '/admin/webhooks')
check("réservés aux admins de l'espace (403)", status == 403, status)
status, body = camille.call('POST', '/admin/webhooks', {'name': 'x', 'url': 'javascript:alert(1)', 'kind': 'generic', 'events': ['page.created']})
check('une adresse non http(s) est refusée', status == 400, (status, msg(body)))
status, body = camille.call('POST', '/admin/webhooks', {'name': 'x', 'url': f'{HOOK}/', 'kind': 'generic', 'events': ['page.exploded']})
check('un événement inconnu est refusé', status == 400, (status, msg(body)))
status, generic = camille.call('POST', '/admin/webhooks', {'name': 'Intégration test', 'url': f'{HOOK}/generic', 'kind': 'generic', 'projectId': paiements, 'events': ['page.created', 'page.updated', 'page.deleted', 'comment.created', 'spec.published']})
check('création d’une intégration générique', status == 201, (status, generic))
status, slack = camille.call('POST', '/admin/webhooks', {'name': 'Canal #paiements', 'url': f'{HOOK}/slack', 'kind': 'slack', 'events': ['page.created']})
_, listing = camille.call('GET', '/admin/webhooks')
secret = next(w['secret'] for w in listing['webhooks'] if w['id'] == generic['id'])
check('la clé de signature est montrée aux admins', secret.startswith('whsec_'), secret[:6])


def verify(r):
    signed = f"{r['headers']['x-andal-timestamp']}.{r['body'].decode()}".encode()
    return r['headers'].get('x-andal-signature') == 'sha256=' + hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()


status, test = camille.call('POST', f"/admin/webhooks/{generic['id']}/test")
ping = wait_for(lambda r: r['path'] == '/generic' and event_of(r) == 'ping', 3)
check('« Tester » envoie un ping signé', status == 200 and test['status'] == 200 and ping is not None and verify(ping), (status, test))
status, test = camille.call('POST', f"/admin/webhooks/{slack['id']}/test")
ping = wait_for(lambda r: r['path'] == '/slack', 3)
check('…au format Slack pour Slack et Mattermost', ping is not None and 'text' in json.loads(ping['body']), ping and ping['body'][:120])

status, made = api.call('POST', f'/projects/{paiements}/pages', {'title': 'Rotation des secrets'}, headers=bearer(write_token))
hit = wait_for(lambda r: r['path'] == '/generic' and event_of(r) == 'page.created' and b'Rotation des secrets' in r['body'])
payload = json.loads(hit['body']) if hit else {}
check('page.created arrive, signé, avec auteur et lien', hit is not None and verify(hit) and payload['actor']['name'].startswith('Aminata') and payload['page']['url'].endswith(f"/p/{made['id']}"), payload)
slack_hit = wait_for(lambda r: r['path'] == '/slack' and b'Rotation des secrets' in r['body'])
check('…et sur le canal Slack, en une phrase', slack_hit is not None and 'a créé une page' in json.loads(slack_hit['body'])['text'], slack_hit and slack_hit['body'][:160])

_, threads = aminata.call('GET', f'/pages/{auth_page}/comments')
status, _ = aminata.call('POST', f"/threads/{threads[0]['id']}/comments", {'body': 'Je mets à jour la section.'})
hit = wait_for(lambda r: r['path'] == '/generic' and event_of(r) == 'comment.created')
check('comment.created arrive avec un extrait', hit is not None and json.loads(hit['body'])['comment']['excerpt'] == 'Je mets à jour la section.', (status, hit and hit['body'][:200]))

spec = b"openapi: 3.0.3\ninfo: { title: API Remboursements, version: '1.0' }\npaths: {}\n"
status, _, raw = api.raw('POST', f'/projects/{paiements}/specs?name=remboursements', spec, {**bearer(write_token), 'content-type': 'application/yaml'})
hit = wait_for(lambda r: r['path'] == '/generic' and event_of(r) == 'spec.published')
check('la CI publie une spec avec un jeton, spec.published arrive', status == 201 and hit is not None and json.loads(hit['body'])['spec']['name'] == 'remboursements', (status, raw[:120]))

status, _ = camille.call('DELETE', f'/pages/{runbook}')
time.sleep(2)
check('une page sous restriction de lecture n’est jamais annoncée', status == 200 and wait_for(lambda r: event_of(r) == 'page.deleted' and runbook.encode() in r['body'], 2) is None, status)
status, _ = camille.call('DELETE', f"/pages/{made['id']}")
hit = wait_for(lambda r: r['path'] == '/generic' and event_of(r) == 'page.deleted')
check('page.deleted arrive pour une page ouverte', hit is not None and json.loads(hit['body'])['page']['id'] == made['id'], hit and hit['body'][:160])

api.call('PUT', f'/pages/{auth_page}/content', {'markdown': markdown.replace('quinze minutes', '15 minutes', 1)}, headers=bearer(write_token))
time.sleep(3)
state = bull(f"const j = await q.getJob('page-updated-{auth_page}'); console.log(j ? await j.getState() : 'absent'); if (j) await j.promote();").strip()
check('page.updated attend la fin de la rafale (tâche différée)', state == 'delayed', state)
hit = wait_for(lambda r: r['path'] == '/generic' and event_of(r) == 'page.updated')
check('…puis arrive au nom de qui a modifié', hit is not None and json.loads(hit['body'])['actor']['name'].startswith('Aminata'), hit and hit['body'][:200])

status, deliveries = camille.call('GET', f"/admin/webhooks/{generic['id']}/deliveries")
check('le journal des envois garde chaque tentative', status == 200 and len(deliveries) >= 5 and all(d['status'] == 200 for d in deliveries), [(d['event'], d['status']) for d in deliveries])
status, failing = camille.call('POST', '/admin/webhooks', {'name': 'En panne', 'url': f'{HOOK}/panne', 'kind': 'generic', 'events': ['page.created']})
api.call('POST', f'/projects/{paiements}/pages', {'title': 'Encore une'}, headers=bearer(write_token))
hit = wait_for(lambda r: r['path'] == '/panne')
time.sleep(1)
_, failed = camille.call('GET', f"/admin/webhooks/{failing['id']}/deliveries")
check('une réponse 500 est notée, et réessayée plus tard', hit is not None and failed and failed[0]['status'] == 500, failed)
status, rotated = camille.call('POST', f"/admin/webhooks/{generic['id']}/rotate")
check('la clé se renouvelle', status == 201 and rotated['secret'] != secret, status)
status, _ = camille.call('DELETE', f"/admin/webhooks/{generic['id']}")
check("l'intégration se supprime", status == 204 and sql(f"select count(*) from webhooks where id = '{generic['id']}'") == '0', status)

print('— Aperçus de liens')
status, _ = aminata.call('GET', '/unfurl?url=' + quote('javascript:alert(1)'))
check('seules les adresses https sont examinées', status == 400, status)
status, _ = aminata.call('GET', '/unfurl?url=' + quote('https://exemple.org/une/page'))
check('une adresse ni GitHub ni Jira: pas d’aperçu (404)', status == 404, status)
status, body = aminata.call('GET', '/unfurl?url=' + quote('https://github.com/nodejs/node/pull/1'))
check('GitHub: titre et état (404 sans réseau)', (status == 200 and body['kind'] == 'github' and body['type'] == 'pull') or status == 404, (status, body))

print('— Révocation')
status, _ = aminata.call('DELETE', f"/me/tokens/{created['id']}")
status2, _ = api.call('GET', '/projects', headers=bearer(write_token))
check('un jeton révoqué ne sert plus (401)', status == 204 and status2 == 401, (status, status2))
sql(f"update api_tokens set expires_at = now() - interval '1 minute' where id = '{read_created['id']}'")
status, _ = api.call('GET', '/projects', headers=bearer(read_token))
check('un jeton expiré non plus', status == 401, status)
nora_id = sql("select id from users where username = 'nora'")
camille.call('POST', f'/admin/accounts/{nora_id}/disable')
status, _ = api.call('GET', '/projects', headers=bearer(nora_token))
check("ni celui d'un compte désactivé", status == 401, status)

server.shutdown()
finish()
