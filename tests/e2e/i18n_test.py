"""Langues: erreurs de l'API selon Accept-Language, langue du compte, appareils des sessions et emails dans la langue de la personne."""
import json
import urllib.request

from harness import DEMO, MAILPIT, Client, check, finish, login, msg, sql


def mailpit(method, path):
    with urllib.request.urlopen(urllib.request.Request(MAILPIT + path, method=method)) as res:
        raw = res.read()
        return json.loads(raw) if method == 'GET' else None


mailpit('DELETE', '/messages')

camille = login('camille')  # propriétaire
aminata = login('aminata')  # membre
lea = login('lea')
lea_id = sql("select id from users where username = 'lea'")

print('— Erreurs de l’API')
status, body = aminata.call('GET', '/admin/scim')
check('sans préférence: en français, comme avant', status == 403 and msg(body) == "Réservé aux admins de l'espace.", (status, msg(body)))
status, body = aminata.call('GET', '/admin/scim', headers={'accept-language': 'en-GB,en;q=0.9,fr;q=0.5'})
check('Accept-Language anglais: en anglais', status == 403 and msg(body) == 'Restricted to workspace admins.', (status, msg(body)))
status, body = aminata.call('GET', '/admin/scim', headers={'accept-language': 'de-DE,fr;q=0.8,en;q=0.5'})
check('la langue connue la mieux classée l’emporte', status == 403 and msg(body).startswith('Réservé'), (status, msg(body)))
status, body = Client().call('POST', '/auth/login', {'identifier': 'lea', 'password': 'pas le bon'}, headers={'accept-language': 'en'})
check('aussi sans session (connexion refusée)', status == 401 and 'password' in msg(body).lower() and 'mot de passe' not in msg(body), (status, msg(body)))

print('— Langue du compte')
_, me = lea.call('GET', '/me')
check('français par défaut', me['user']['locale'] == 'fr', me['user'].get('locale'))
status, body = lea.call('PUT', '/me/locale', {'locale': 'de'})
check('une langue inconnue est refusée (400)', status == 400, (status, msg(body)))
status, _ = lea.call('PUT', '/me/locale', {'locale': 'en'})
_, me = lea.call('GET', '/me')
check('passe en anglais', status == 204 and me['user']['locale'] == 'en', (status, me['user'].get('locale')))

print('— Appareils des sessions')
phone = Client()
phone.call('POST', '/auth/login', {'identifier': 'lea', 'password': DEMO}, headers={'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1'})
_, sessions = lea.call('GET', '/me/sessions', headers={'accept-language': 'en'})
check('l’interface en anglais lit « Safari on iOS »', any(s['device'] == 'Safari on iOS' for s in sessions), [s['device'] for s in sessions])
_, sessions = lea.call('GET', '/me/sessions')
check('en français: « Safari sur iOS »', any(s['device'] == 'Safari sur iOS' for s in sessions), [s['device'] for s in sessions])

print('— Emails')
status, _ = camille.call('POST', f'/admin/accounts/{lea_id}/reset-password')
data = mailpit('GET', '/messages')
subjects = [m['Subject'] for m in data['messages'] if m['To'][0]['Address'] == sql(f"select email from users where id = '{lea_id}'")]
check('l’email part dans la langue de la personne visée, pas de l’admin', status in (200, 201) and 'Choose a new Andal password' in subjects, subjects)

status, _ = lea.call('PUT', '/me/locale', {'locale': 'fr'})
_, me = lea.call('GET', '/me')
check('retour au français', status == 204 and me['user']['locale'] == 'fr')

finish()
