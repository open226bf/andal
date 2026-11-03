"""Tests de bout en bout: gestion des accès, groupes, citations et notifications (API + Mailpit)."""
import http.cookiejar
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
API = os.environ.get('ANDAL_API', 'http://127.0.0.1:3001/api')
MAILPIT = os.environ.get('ANDAL_MAILPIT', 'http://127.0.0.1:58025/api/v1')
ORIGIN = os.environ.get('WEB_ORIGIN', 'http://localhost:5173')
env = dict(line.split('=', 1) for line in open(f'{ROOT}/.env').read().splitlines() if '=' in line and not line.startswith('#'))
DEMO = env['DEMO_PASSWORD'].strip('"')
DELAY = int(env.get('NOTIFY_EMAIL_DELAY', '300'))


class Client:
    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def call(self, method, path, body=None, base=API):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(base + path, data=data, method=method, headers={'content-type': 'application/json'} if data else {})
        try:
            with self.opener.open(req) as res:
                return res.status, parse(res.read())
        except urllib.error.HTTPError as err:
            return err.code, parse(err.read())


def parse(raw):
    try:
        return json.loads(raw) if raw else None
    except ValueError:
        return raw.decode()


def login(user, password=DEMO):
    c = Client()
    status, _ = c.call('POST', '/auth/login', {'identifier': user, 'password': password})
    assert status == 200, (user, status)
    return c


failures = 0


def check(label, ok, detail=''):
    global failures
    print(('OK   ' if ok else 'ÉCHEC') + f' {label}' + (f' — {detail}' if detail else ''))
    if not ok:
        failures += 1


def msg(body):
    return body.get('message') if isinstance(body, dict) else body


Client().call('DELETE', '/messages', base=MAILPIT)
camille, aminata, thomas, lea, nora = (login(u) for u in ['camille', 'aminata', 'thomas', 'lea', 'nora'])

# Pages et identifiants
_, tree = camille.call('GET', '/projects/paiements/tree')
pages = {p['title']: p for p in tree['pages']}
auth_id, glossaire_id, conventions_id = pages['Authentification']['id'], pages['Glossaire']['id'], pages['Conventions']['id']
paiements = tree['project']['id']
_, identite_tree = camille.call('GET', '/projects/identite/tree')
identite = identite_tree['project']['id']
_, accounts = camille.call('GET', '/admin/accounts')
ids = {u['username']: u['id'] for u in accounts['users']}
groups = {g['name']: g['id'] for g in accounts['groups']}

print('\n— Partage d’un volume')
_, share = lea.call('GET', f'/pages/{auth_id}/sharing')
check('une commentatrice voit les accès sans pouvoir les modifier', not share['canShare'] and not share['canRestrict'] and share['directory'] is None, f"rôle {share['role']}")
_, share = camille.call('GET', f'/pages/{auth_id}/sharing')
check('la propriétaire reçoit l’annuaire', share['canShare'] and len(share['directory']) == 8, f"{len(share['directory'])} entrées, grants: {[(g['principal']['name'], g['role']) for g in share['grants']]}")
status, body = camille.call('PUT', f'/projects/{paiements}/grants', {'type': 'user', 'id': ids['nora'], 'role': 'admin'})
check('un invité ne peut pas administrer un volume', status == 400, msg(body))
status, _ = camille.call('PUT', f'/projects/{paiements}/grants', {'type': 'user', 'id': ids['nora'], 'role': 'editor'})
_, page = nora.call('GET', f'/pages/{glossaire_id}')
check('Nora passe éditrice du volume', status == 204 and page['role'] == 'editor', page['role'])
status, _ = camille.call('PUT', f'/projects/{paiements}/grants', {'type': 'user', 'id': ids['lea'], 'role': 'admin'})
_, share = lea.call('GET', f'/pages/{auth_id}/sharing')
check('Léa devient admin du volume et peut partager', status == 204 and share['canShare'])
status, body = lea.call('DELETE', f"/projects/{paiements}/grants/user/{ids['lea']}")
check('on ne se retire pas soi-même l’administration', status == 409, msg(body))
status, body = lea.call('PUT', f'/projects/{paiements}/grants', {'type': 'user', 'id': ids['lea'], 'role': 'editor'})
check('…ni en se rétrogradant', status == 409, msg(body))
status, _ = lea.call('PUT', f'/projects/{paiements}/grants', {'type': 'user', 'id': ids['nora'], 'role': 'reader'})
check('admin du volume, Léa remet Nora en lecture', status == 204)
status, _ = camille.call('DELETE', f"/projects/{paiements}/grants/user/{ids['lea']}")
_, page = lea.call('GET', f'/pages/{glossaire_id}')
check('grant direct retiré: Léa redevient commentatrice (par son groupe)', status == 204 and page['role'] == 'commenter', page['role'])
status, _ = thomas.call('PUT', f'/projects/{paiements}/grants', {'type': 'user', 'id': ids['lea'], 'role': 'editor'})
check('un éditeur ne partage pas le volume', status == 403)

print('\n— Restrictions de page')
status, body = lea.call('PUT', f'/pages/{glossaire_id}/restrictions/view', {'principals': [{'type': 'user', 'id': ids['lea']}]})
check('une commentatrice ne restreint pas', status == 403, msg(body))
status, body = thomas.call('PUT', f'/pages/{glossaire_id}/restrictions/view', {'principals': [{'type': 'user', 'id': ids['aminata']}]})
check('on ne s’enferme pas dehors', status == 409, msg(body))
status, _ = thomas.call('PUT', f'/pages/{glossaire_id}/restrictions/view', {'principals': [{'type': 'user', 'id': ids['thomas']}]})
s_page, _ = aminata.call('GET', f'/pages/{glossaire_id}')
_, a_tree = aminata.call('GET', '/projects/paiements/tree')
s_search, hits = aminata.call('GET', '/search?q=glossaire')
check('lecture réservée à Thomas: Aminata ne voit plus la page', status == 204 and s_page == 404 and all(p['title'] != 'Glossaire' for p in a_tree['pages']) and all(h['title'] != 'Glossaire' for h in hits), f'page {s_page}')
_, share = thomas.call('GET', f'/pages/{glossaire_id}/sharing')
check('le panneau montre la restriction', [p['name'] for p in share['pageRestrictions']['view']] == ['Thomas R.'])
status, _ = thomas.call('PUT', f'/pages/{glossaire_id}/restrictions/view', {'principals': []})
s_page, _ = aminata.call('GET', f'/pages/{glossaire_id}')
check('restriction levée: Aminata revoit la page', status == 204 and s_page == 200)
status, _ = thomas.call('PUT', f'/pages/{conventions_id}/restrictions/edit', {'principals': [{'type': 'user', 'id': ids['thomas']}, {'type': 'group', 'id': groups['Sécurité']}]})
_, page = aminata.call('GET', f'/pages/{conventions_id}')
_, page_lea = lea.call('GET', f'/pages/{conventions_id}')
check('écriture réservée: Aminata plafonne à commentaire, Léa (Sécurité) reste commentatrice', status == 204 and page['role'] == 'commenter' and page_lea['role'] == 'commenter', f"{page['role']} / {page_lea['role']}")
thomas.call('PUT', f'/pages/{conventions_id}/restrictions/edit', {'principals': []})

print('\n— Groupes')
status, _ = aminata.call('GET', '/admin/groups')
check('un membre ne gère pas les groupes', status == 403)
status, created = camille.call('POST', '/admin/groups', {'name': 'Prestataires'})
check('groupe créé', status == 201)
prestataires = created['id']
status, body = camille.call('POST', '/admin/groups', {'name': 'prestataires '})
check('deux groupes ne portent pas le même nom', status == 409, msg(body))
camille.call('PUT', f"/admin/groups/{prestataires}/members/{ids['nora']}")
camille.call('PUT', f'/projects/{identite}/grants', {'type': 'group', 'id': prestataires, 'role': 'reader'})
_, projects = nora.call('GET', '/projects')
check('Nora rejoint Prestataires et voit Identité', any(p['slug'] == 'identite' for p in projects), [p['slug'] for p in projects])
_, overview = camille.call('GET', '/admin/groups')
g = next(x for x in overview['groups'] if x['id'] == prestataires)
check('l’écran Groupes montre membres et volumes', [m['name'] for m in g['members']] == ['Nora B. (prestataire)'] and g['volumes'][0]['shortName'] == 'Identité')
camille.call('DELETE', f"/admin/groups/{prestataires}/members/{ids['nora']}")
_, projects = nora.call('GET', '/projects')
check('retirée du groupe, Nora perd Identité', all(p['slug'] != 'identite' for p in projects))
status, body = camille.call('DELETE', f"/admin/groups/{groups['Équipe Paiements']}")
check('un groupe qui restreint une page ne se supprime pas', status == 409, msg(body))
status, _ = camille.call('DELETE', f'/admin/groups/{prestataires}')
_, share = camille.call('GET', f'/pages/{auth_id}/sharing')
check('groupe supprimé', status == 204 and all(e['id'] != prestataires for e in share['directory']))

print('\n— Invitation avec groupes')
status, result = camille.call('POST', '/admin/invitations', {'email': 'ines@andal.test', 'name': 'Inès B.', 'role': 'member', 'groupIds': [groups['Équipe Paiements']]})
token = result['link'].rsplit('/', 1)[1]
_, info = Client().call('GET', f'/auth/links/{token}')
check('le lien annonce les groupes', info['groups'] == ['Équipe Paiements'], info['groups'])
ines = Client()
status, _ = ines.call('POST', '/auth/invitations/accept', {'token': token, 'name': 'Inès B.', 'username': 'ines', 'password': 'une phrase de passe toute neuve'})
_, projects = ines.call('GET', '/projects')
# Le groupe Équipe Paiements ouvre Paiements et Facturation (seed).
check('Inès arrive avec les volumes de son groupe ouverts', status == 201 and [p['slug'] for p in projects] == ['paiements', 'facturation'], [p['slug'] for p in projects])
_, result = camille.call('POST', '/admin/invitations', {'email': 'omar@andal.test', 'name': 'Omar S.', 'role': 'member'})
omar = Client()
omar.call('POST', '/auth/invitations/accept', {'token': result['link'].rsplit('/', 1)[1], 'name': 'Omar S.', 'username': 'omar', 'password': 'une phrase de passe toute neuve'})
_, projects = omar.call('GET', '/projects')
check('Omar, invité sans groupe, n’a aucun volume', projects == [])

print('\n— Citations et notifications')
Client().call('DELETE', '/messages', base=MAILPIT)
_, inbox = aminata.call('GET', '/notifications')
check('la citation de démo attend Aminata', inbox['unread'] == 1 and inbox['items'][0]['kind'] == 'mention', inbox['items'][0]['excerpt'])
_, people = lea.call('GET', f'/pages/{auth_id}/mentionable')
names = sorted(p['username'] for p in people)
check('on ne peut citer que qui lit la page', 'ines' in names and 'omar' not in names, names)
_, threads = lea.call('GET', f'/pages/{auth_id}/comments')
header = next(t for t in threads if t['comments'][0]['author']['name'] == 'Thomas R.')
lea.call('PUT', '/notifications/email', {'enabled': False})
status, posted = lea.call('POST', f"/threads/{header['id']}/comments", {'body': '@aminata @nora, @thomas. et @omar : d’accord avec ça.'})
check('réponse publiée; Omar, qui ne lit pas la page, est signalé', status == 201 and posted['unreachable'] == ['Omar S.'], posted)
_, threads = lea.call('GET', f'/pages/{auth_id}/comments')
reply = next(t for t in threads if t['id'] == header['id'])['comments'][-1]
check('les citations sont enregistrées', sorted(m['username'] for m in reply['mentions']) == ['aminata', 'nora', 'thomas'], [m['username'] for m in reply['mentions']])
_, inbox_t = thomas.call('GET', '/notifications')
_, inbox_a = aminata.call('GET', '/notifications')
_, inbox_o = omar.call('GET', '/notifications')
check('Thomas, cité et participant, reçoit une seule notification (citation)', [i['kind'] for i in inbox_t['items']] == ['mention'], [i['kind'] for i in inbox_t['items']])
check('Aminata a maintenant deux citations non lues', inbox_a['unread'] == 2 and inbox_a['items'][0]['actor']['name'] == 'Léa M.')
check('Omar ne reçoit rien', inbox_o['items'] == [])
status, posted = thomas.call('POST', f"/threads/{header['id']}/comments", {'body': 'Je reformule tout à l’heure.'})
_, inbox_l = lea.call('GET', '/notifications')
check('sans citation, les participants du fil sont prévenus (Léa: réponse)', [i['kind'] for i in inbox_l['items']] == ['reply'], [i['kind'] for i in inbox_l['items']])
_, inbox_a2 = aminata.call('GET', '/notifications')
check('…mais pas qui a seulement été cité', inbox_a2['unread'] == 2)
aminata.call('POST', f"/threads/{header['id']}/resolve")
_, inbox_t = thomas.call('GET', '/notifications')
check('Thomas apprend qu’Aminata a résolu son fil', inbox_t['items'][0]['kind'] == 'resolved' and inbox_t['items'][0]['actor']['name'] == 'Aminata K.')
thomas.call('POST', '/notifications/read', {'ids': [inbox_t['items'][0]['id']]})
_, inbox_t = thomas.call('GET', '/notifications')
check('marquer une notification comme lue', inbox_t['unread'] == 1)
thomas.call('POST', '/notifications/read', {})
_, inbox_t = thomas.call('GET', '/notifications')
check('tout marquer comme lu', inbox_t['unread'] == 0)

thomas.call('PUT', f'/pages/{auth_id}/restrictions/view', {'principals': [{'type': 'user', 'id': ids['thomas']}]})
_, inbox_l = lea.call('GET', '/notifications')
check('page devenue illisible: ses notifications disparaissent pour Léa', inbox_l['items'] == [])
thomas.call('PUT', f'/pages/{auth_id}/restrictions/view', {'principals': []})
_, inbox_l = lea.call('GET', '/notifications')
check('…et reviennent quand l’accès revient', len(inbox_l['items']) == 1)

print(f'\n— Emails (attente {DELAY + 15} s)')
time.sleep(DELAY + 15)
_, data = Client().call('GET', '/messages', base=MAILPIT)
to = sorted(m['To'][0]['Address'] for m in data['messages'])
check('emails seulement pour les non-lus: Aminata et Nora; pas Thomas (lu), pas Léa (désactivé)', to == ['aminata@andal.test', 'nora@andal.test'], to)
nora_mail = next((m for m in data['messages'] if m['To'][0]['Address'] == 'nora@andal.test'), None)
if nora_mail:
    _, full = Client().call('GET', f"/message/{nora_mail['ID']}", base=MAILPIT)
    link = re.search(re.escape(ORIGIN) + r'/v/paiements/[0-9a-f-]+\?fil=[0-9a-f-]+', full['Text'])
    check('l’email cite le commentaire et mène au fil', nora_mail['Subject'].startswith('Léa M. vous a cité') and link is not None and 'd’accord avec ça' in full['Text'], nora_mail['Subject'])
_, inbox_n = nora.call('GET', '/notifications')
check('l’email ne marque pas la notification comme lue', inbox_n['unread'] == 1)
lea.call('PUT', '/notifications/email', {'enabled': True})

print(f'\n{failures} échec(s)')
sys.exit(1 if failures else 0)
