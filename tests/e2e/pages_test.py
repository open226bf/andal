"""Tests de bout en bout des pages: créer, renommer, déplacer, corbeille, restaurer."""
import http.cookiejar
import json
import os
import sys
import urllib.error
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
API = os.environ.get('ANDAL_API', 'http://127.0.0.1:3001/api')
env = dict(line.split('=', 1) for line in open(f'{ROOT}/.env').read().splitlines() if '=' in line and not line.startswith('#'))
DEMO = env['DEMO_PASSWORD'].strip('"')


class Client:
    def __init__(self):
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def call(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(API + path, data=data, method=method, headers={'content-type': 'application/json'} if data else {})
        try:
            with self.opener.open(req) as res:
                raw = res.read()
                return res.status, json.loads(raw) if raw else None
        except urllib.error.HTTPError as err:
            raw = err.read()
            try:
                return err.code, json.loads(raw)
            except ValueError:
                return err.code, raw.decode()


def login(user):
    c = Client()
    assert c.call('POST', '/auth/login', {'identifier': user, 'password': DEMO})[0] == 200
    return c


failures = 0


def check(label, ok, detail=''):
    global failures
    print(('OK   ' if ok else 'ÉCHEC') + f' {label}' + (f' — {detail}' if detail else ''))
    failures += 0 if ok else 1


def msg(body):
    return body.get('message') if isinstance(body, dict) else body


aminata, thomas, lea, camille = (login(u) for u in ['aminata', 'thomas', 'lea', 'camille'])


def tree(c=None):
    _, t = (c or aminata).call('GET', '/projects/paiements/tree')
    return t


def by_title(t):
    return {p['title']: p for p in t['pages']}


t = tree()
project = t['project']['id']
pages = by_title(t)

print('— Créer')
status, body = lea.call('POST', f'/projects/{project}/pages', {'title': 'Note de Léa'})
check('une commentatrice ne crée pas de page', status == 403, msg(body))
status, body = aminata.call('POST', f'/projects/{project}/pages', {'title': '   '})
check('un titre vide est refusé', status == 400, msg(body))
status, created = aminata.call('POST', f'/projects/{project}/pages', {'title': 'Annexes'})
annexes = created['id']
check('page créée au premier niveau, en dernier', status == 201 and by_title(tree())['Annexes']['number'] == '7', by_title(tree())['Annexes']['number'])
status, created = aminata.call('POST', f'/projects/{project}/pages', {'title': 'Erreurs', 'parentId': pages['API']['id']})
erreurs = created['id']
_, page = aminata.call('GET', f'/pages/{erreurs}')
check('sous-page créée sous API, vide et modifiable', status == 201 and page['number'] == '3.5' and page['role'] == 'editor' and page['version'] == 1, page['number'])
status, body = aminata.call('POST', f'/projects/{project}/pages', {'title': 'Annexe', 'parentId': pages['Webhooks']['id']})
check('pas de sous-page là où on ne peut qu’annoter (Webhooks)', status == 403, msg(body))
_, other = aminata.call('GET', '/projects/identite/tree')
status, body = aminata.call('POST', f'/projects/{project}/pages', {'title': 'Ailleurs', 'parentId': other['pages'][0]['id']}) if other.get('pages') else (None, None)
check('pas de page sous une page d’un autre volume', status in (400, 404), f'{status} {msg(body)}')

print('\n— Renommer')
status, _ = aminata.call('PATCH', f'/pages/{erreurs}', {'title': 'Codes d’erreur', 'summary': 'Ce que renvoie l’API quand ça se passe mal.'})
_, page = aminata.call('GET', f'/pages/{erreurs}')
# Juste après la création: même séance de travail, donc toujours la v1 (voir versions_test.py).
check('titre et chapeau modifiés, dans la même version', status == 204 and page['title'] == 'Codes d’erreur' and page['version'] == 1 and page['summary'], (page['title'], page['version']))
status, body = lea.call('PATCH', f'/pages/{erreurs}', {'title': 'Autre'})
check('une commentatrice ne renomme pas', status == 403, msg(body))
_, hits = lea.call('GET', '/search?q=codes%20erreur')
check('le nouveau titre se trouve à la recherche', any(h['id'] == erreurs for h in hits))

print('\n— Déplacer')
status, _ = aminata.call('POST', f'/pages/{erreurs}/move', {'parentId': pages['API']['id'], 'beforeId': pages['Conventions']['id']})
nums = {p['title']: p['number'] for p in tree()['pages']}
check('monter en tête de section', status == 204 and nums['Codes d’erreur'] == '3.1' and nums['Conventions'] == '3.2' and nums['Authentification'] == '3.3', nums['Codes d’erreur'])
status, _ = aminata.call('POST', f"/pages/{pages['API']['id']}/move", {'parentId': pages['Architecture']['id']})
nums = {p['title']: p['number'] for p in tree()['pages']}
_, auth_page = aminata.call('GET', f"/pages/{pages['Authentification']['id']}")
_, threads = aminata.call('GET', f"/pages/{pages['Authentification']['id']}/comments")
check('une branche entière change de parente, sous-pages et fils compris', status == 204 and nums['API'] == '2.3' and nums['Authentification'] == '2.3.3' and auth_page['breadcrumb'][0]['title'] == 'Architecture' and len(threads) == 2, f"{nums['API']} / {nums['Authentification']}")
status, body = aminata.call('POST', f"/pages/{pages['API']['id']}/move", {'parentId': pages['Authentification']['id']})
check('pas sous une de ses sous-pages', status == 400, msg(body))
status, _ = aminata.call('POST', f"/pages/{pages['API']['id']}/move", {'parentId': None, 'beforeId': pages['Exploitation']['id']})
nums = {p['title']: p['number'] for p in tree()['pages']}
check('et retour au premier niveau, à sa place', status == 204 and nums['API'] == '3' and nums['Authentification'] == '3.3' and nums['Exploitation'] == '4', nums['API'])
status, created = aminata.call('POST', f'/projects/{project}/pages', {'title': 'Procédure', 'parentId': pages['Runbook incident']['id']})
procedure = created['id']
status_lea, _ = lea.call('GET', f'/pages/{procedure}')
check('une sous-page hérite de la restriction de sa parente (Léa ne la voit pas)', status == 201 and status_lea == 404)
status, body = aminata.call('POST', f'/pages/{procedure}/move', {'parentId': None})
check('elle ne peut pas sortir de la restriction héritée', status == 409, msg(body))
status, _ = aminata.call('POST', f"/pages/{pages['Runbook incident']['id']}/move", {'parentId': None})
status_lea, _ = lea.call('GET', f"/pages/{pages['Runbook incident']['id']}")
check('une page restreinte elle-même emporte sa restriction', status == 204 and status_lea == 404)
aminata.call('POST', f"/pages/{pages['Runbook incident']['id']}/move", {'parentId': pages['Exploitation']['id'], 'beforeId': pages['Astreinte']['id']})
status, body = lea.call('POST', f'/pages/{erreurs}/move', {'parentId': None})
check('une commentatrice ne déplace pas', status == 403, msg(body))

print('\n— Corbeille')
status, body = aminata.call('DELETE', f"/pages/{pages['API']['id']}")
check('pas de corbeille pour une branche qu’on ne peut pas toute modifier (Webhooks)', status == 403, msg(body))
status, body = thomas.call('DELETE', f"/pages/{pages['Jetons utilisateur']['id']}")
s_page, _ = aminata.call('GET', f"/pages/{pages['Jetons utilisateur']['id']}")
_, hits = aminata.call('GET', '/search?q=jetons%20utilisateur')
nums = {p['title']: p['number'] for p in tree()['pages']}
check('page à la corbeille: hors du sommaire, de la recherche, 404', status == 200 and s_page == 404 and 'Jetons utilisateur' not in nums and all(h['title'] != 'Jetons utilisateur' for h in hits), body)
_, branch = aminata.call('POST', f'/projects/{project}/pages', {'title': 'Branche'})
_, leaf = aminata.call('POST', f'/projects/{project}/pages', {'title': 'Feuille', 'parentId': branch['id']})
status, body = aminata.call('DELETE', f"/pages/{branch['id']}")
_, trash = aminata.call('GET', f'/projects/{project}/trash')
entries = {e['title']: e for e in trash}
check('une branche va à la corbeille d’un bloc', status == 200 and body['pages'] == 2 and entries['Branche']['subpages'] == 1 and 'Feuille' not in entries and entries['Jetons utilisateur']['deletedBy'] == 'Thomas R.', [(e['title'], e['subpages']) for e in trash])
status, _ = lea.call('GET', f'/projects/{project}/trash')
check('la corbeille est réservée à qui écrit sur le volume', status == 403)
status, _ = aminata.call('POST', f"/pages/{branch['id']}/restore")
nums = {p['title']: p['number'] for p in tree()['pages']}
check('restaurer une branche la rend entière', status == 204 and 'Branche' in nums and nums['Feuille'] == nums['Branche'] + '.1', nums.get('Branche'))
aminata.call('DELETE', f"/pages/{leaf['id']}")
aminata.call('DELETE', f"/pages/{branch['id']}")
status, body = aminata.call('POST', f"/pages/{leaf['id']}/restore")
check('une page dont la parente est à la corbeille attend sa parente', status == 409, msg(body))
aminata.call('POST', f"/pages/{branch['id']}/restore")
nums = {p['title']: p['number'] for p in tree()['pages']}
check('la parente revient seule (la feuille avait été jetée avant)', 'Branche' in nums and 'Feuille' not in nums)
status, _ = aminata.call('POST', f"/pages/{leaf['id']}/restore")
nums = {p['title']: p['number'] for p in tree()['pages']}
check('puis la feuille', status == 204 and 'Feuille' in nums)
status, body = aminata.call('POST', f"/pages/{pages['Jetons utilisateur']['id']}/restore")
nums = {p['title']: p['number'] for p in tree()['pages']}
check('Jetons utilisateur revient, en fin de section', status == 204 and nums['Jetons utilisateur'] == '3.5', nums.get('Jetons utilisateur'))
status, body = camille.call('POST', f"/pages/{pages['Glossaire']['id']}/restore")
check('on ne restaure pas une page qui n’est pas à la corbeille', status == 404)

print(f'\n{failures} échec(s)')
sys.exit(1 if failures else 0)
