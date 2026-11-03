"""Tests de bout en bout de la gestion des comptes (API + Mailpit)."""
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
    return c, status


def check(label, ok, detail=''):
    print(('OK   ' if ok else 'ÉCHEC') + f' {label}' + (f' — {detail}' if detail else ''))
    if not ok:
        global failures
        failures += 1


def mails():
    status, data = Client().call('GET', '/messages', base=MAILPIT)
    return data['messages']


def mail_link(to, kind):
    for m in mails():
        if m['To'][0]['Address'] == to:
            _, full = Client().call('GET', f"/message/{m['ID']}", base=MAILPIT)
            found = re.search(rf'{re.escape(ORIGIN)}/{kind}/[A-Za-z0-9_-]+', full['Text'])
            if found:
                return found.group(0)
    return None


failures = 0
Client().call('DELETE', '/messages', base=MAILPIT)

camille, _ = login('camille')
aminata, _ = login('aminata')
lea, _ = login('lea')

status, _ = aminata.call('GET', '/admin/accounts')
check('un membre ne voit pas l’administration', status == 403, str(status))

status, overview = camille.call('GET', '/admin/accounts')
users = {u['email']: u for u in overview['users']}
check('la propriétaire voit les comptes', status == 200 and len(users) == 5, f"{len(users)} comptes, rôles attribuables {overview['assignableRoles']}, mail={overview['mail']}")
me = next(u for u in overview['users'] if u['you'])
check('impossible de se gérer soi-même', not me['manageable'])
status, body = camille.call('POST', f"/admin/accounts/{me['id']}/disable")
check('se désactiver soi-même est refusé', status == 403, body and body.get('message'))

# Invitation
status, result = camille.call('POST', '/admin/invitations', {'email': 'Sami@Andal.test', 'name': 'Sami T.', 'role': 'member'})
check('invitation créée et envoyée par email', status == 201 and result['emailed'] and result['link'], str(result))
time.sleep(0.5)
link = mail_link('sami@andal.test', 'invitation')
check('l’email d’invitation contient le lien', link == result['link'])
token = link.rsplit('/', 1)[1]
status, body = camille.call('POST', '/admin/invitations', {'email': 'lea@andal.test', 'role': 'member'})
check('inviter une adresse déjà inscrite est refusé', status == 409, body['message'])
status, body = Client().call('GET', f'/auth/links/{token}')
check('le lien se décrit sans session', status == 200 and body['kind'] == 'invite' and body['suggestedUsername'] == 'sami', json.dumps(body, ensure_ascii=False))
sami = Client()
status, body = sami.call('POST', '/auth/invitations/accept', {'token': token, 'name': 'Sami T.', 'username': 'sami', 'password': 'court'})
check('mot de passe faible refusé', status == 400, body['message'])
status, body = sami.call('POST', '/auth/invitations/accept', {'token': token, 'name': 'Sami T.', 'username': 'sami', 'password': 'une phrase de passe toute neuve'})
status2, mine = sami.call('GET', '/me')
check('invitation acceptée, session ouverte', status == 201 and status2 == 200 and mine['user']['workspaceRole'] == 'member', f"{mine['user']['name']} {mine['user']['email']}")
status, body = Client().call('POST', '/auth/invitations/accept', {'token': token, 'name': 'X', 'username': 'x2', 'password': 'une autre phrase de passe'})
check('un lien d’invitation ne sert qu’une fois', status == 410, str(status))

# Rôles
status, overview = camille.call('GET', '/admin/accounts')
users = {u['email']: u for u in overview['users']}
thomas_id = users['thomas@andal.test']['id']
status, _ = camille.call('PATCH', f'/admin/accounts/{thomas_id}', {'role': 'admin'})
thomas, _ = login('thomas')
status2, tview = thomas.call('GET', '/admin/accounts')
check('Thomas devient admin et accède à l’administration', status == 204 and status2 == 200, f"rôles attribuables: {tview['assignableRoles']}")
camille_id = me['id']
status, body = thomas.call('POST', f'/admin/accounts/{camille_id}/disable')
check('un admin ne touche pas à une propriétaire', status == 403, body['message'])
status, body = thomas.call('POST', '/admin/invitations', {'email': 'boss@andal.test', 'role': 'owner'})
check('un admin ne peut pas inviter de propriétaire', status == 403, body['message'])

# Désactivation
lea_id = users['lea@andal.test']['id']
status, _ = thomas.call('POST', f'/admin/accounts/{lea_id}/disable')
status2, _ = lea.call('GET', '/me')
check('désactiver Léa coupe sa session', status == 204 and status2 == 401, f'/me → {status2}')
_, status3 = login('lea')
_, body = Client().call('POST', '/auth/login', {'identifier': 'lea', 'password': DEMO})
check('Léa désactivée ne peut plus se connecter', status3 == 403, body['message'])
_, body = Client().call('POST', '/auth/login', {'identifier': 'lea', 'password': 'mauvais-mot-de-passe'})
check('…mais sans le bon mot de passe on n’apprend rien', body['message'] == 'Identifiant ou mot de passe incorrect.')
status, body = thomas.call('POST', f'/admin/accounts/{lea_id}/reset-password')
check('pas de réinitialisation sur un compte désactivé', status == 409, body['message'])
status, _ = thomas.call('POST', f'/admin/accounts/{lea_id}/enable')
_, status2 = login('lea')
check('Léa réactivée peut se reconnecter', status == 204 and status2 == 200)

# Réinitialisation par un admin
nora_id = users['nora@andal.test']['id']
nora_old, _ = login('nora')
status, result = thomas.call('POST', f'/admin/accounts/{nora_id}/reset-password')
check('réinitialisation: email envoyé, lien non montré à l’admin', status == 201 and result['emailed'] and result['link'] is None, str(result))
time.sleep(0.5)
link = mail_link('nora@andal.test', 'reinitialiser')
check('l’email de réinitialisation contient le lien', link is not None)
token = link.rsplit('/', 1)[1]
status, body = Client().call('POST', '/auth/password/reset', {'token': token, 'password': 'nora-mot-de-passe-long'})
check('le nouveau mot de passe ne peut pas contenir l’identifiant', status == 400, body['message'])
status, _ = Client().call('POST', '/auth/password/reset', {'token': token, 'password': 'une toute nouvelle phrase'})
_, old_status = login('nora')
_, new_status = login('nora', 'une toute nouvelle phrase')
status_old_session, _ = nora_old.call('GET', '/me')
check('mot de passe changé: ancien refusé, nouveau accepté, sessions fermées', status == 204 and old_status == 401 and new_status == 200 and status_old_session == 401, f'ancien {old_status}, nouveau {new_status}, ancienne session {status_old_session}')
status, _ = Client().call('POST', '/auth/password/reset', {'token': token, 'password': 'encore une autre phrase'})
check('un lien de réinitialisation ne sert qu’une fois', status == 410)

# Mot de passe oublié
Client().call('DELETE', '/messages', base=MAILPIT)
s1, _ = Client().call('POST', '/auth/password/forgot', {'email': 'aminata@andal.test'})
s2, _ = Client().call('POST', '/auth/password/forgot', {'email': 'personne@andal.test'})
time.sleep(1)
to = [m['To'][0]['Address'] for m in mails()]
check('mot de passe oublié: même réponse, email seulement si le compte existe', s1 == s2 == 202 and to == ['aminata@andal.test'], f'{s1}/{s2}, emails vers {to}')

# Invitation: renvoi et révocation
status, result = camille.call('POST', '/admin/invitations', {'email': 'ines@andal.test', 'role': 'guest'})
first = result['link'].rsplit('/', 1)[1]
status, overview = camille.call('GET', '/admin/accounts')
invitation = next(i for i in overview['invitations'] if i['email'] == 'ines@andal.test')
status, result = camille.call('POST', f"/admin/invitations/{invitation['id']}/resend")
s_old, _ = Client().call('GET', f'/auth/links/{first}')
check('renvoyer une invitation invalide l’ancien lien', status == 201 and s_old == 410)
status, _ = camille.call('DELETE', f"/admin/invitations/{invitation['id']}")
s_new, _ = Client().call('GET', f"/auth/links/{result['link'].rsplit('/', 1)[1]}")
check('révoquer une invitation invalide son lien', status == 204 and s_new == 410)

print(f'\n{failures} échec(s)')
sys.exit(1 if failures else 0)
