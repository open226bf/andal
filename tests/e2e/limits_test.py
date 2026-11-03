"""Limite de débit de l'API (par session, jeton ou adresse) et adresse IP du client derrière un proxy de confiance."""
import time

from harness import Client, check, finish, login, sql

camille = login('camille')
aminata = login('aminata')

print('— En-têtes')
anonymous = Client()
status, headers, _ = anonymous.raw('GET', '/auth/config')
check('une requête sans session porte les en-têtes RateLimit', status == 200 and int(headers['ratelimit-limit']) > 0 and int(headers['ratelimit-remaining']) < int(headers['ratelimit-limit']), {k: v for k, v in headers.items() if k.startswith('ratelimit')})
status, headers, _ = camille.raw('GET', '/me')
check('une session a son propre compte', status == 200 and 'ratelimit-remaining' in headers, headers.get('ratelimit-limit'))
status, headers, _ = camille.raw('GET', '/health')
check('la sonde de santé n’est jamais comptée', status == 200 and 'ratelimit-limit' not in headers)

print('— Plafond des écritures')
_, first = aminata.call('POST', '/me/tokens', {'name': 'rafale', 'scope': 'write'})
_, other = aminata.call('POST', '/me/tokens', {'name': 'voisin', 'scope': 'write'})
bot = Client()
auth = {'authorization': f"Bearer {first['token']}", 'content-type': 'application/json'}
# Toute la rafale dans la même minute.
while 60 - time.time() % 60 < 25:
    time.sleep(1)
missing = '/pages/00000000-0000-0000-0000-000000000000'
statuses = []
limit = None
for _ in range(400):
    status, headers, _ = bot.raw('PATCH', missing, b'{}', auth)
    limit = limit or int(headers.get('ratelimit-limit', 0))
    statuses.append(status)
    if status == 429:
        break
check('les écritures passent jusqu’au plafond', limit and statuses.count(404) == limit, (limit, statuses.count(404)))
check('puis 429 avec Retry-After', statuses[-1] == 429 and 0 < int(headers.get('retry-after', 0)) <= 60, (statuses[-1], headers.get('retry-after')))
status, headers, _ = bot.raw('GET', missing, None, {'authorization': f"Bearer {first['token']}"})
check('les lectures du même jeton ont leur propre plafond', status == 404 and int(headers['ratelimit-remaining']) > 0, status)
status, _, _ = Client().raw('PATCH', missing, b'{}', {'authorization': f"Bearer {other['token']}", 'content-type': 'application/json'})
check('un autre jeton n’est pas freiné', status == 404, status)
status, _ = aminata.call('PATCH', missing, {})
check('ni la session de la même personne', status == 404, status)

print('— Adresse du client')
c = Client()
from harness import DEMO
status, _, _ = c.raw('POST', '/auth/login', f'{{"identifier":"nora","password":"{DEMO}"}}'.encode(), {'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7'})
ip = sql("select ip from audit_events where action = 'auth.login' and actor_id = (select id from users where username = 'nora') order by id desc limit 1")
check('derrière un proxy de confiance (ici, la machine), l’adresse vient de X-Forwarded-For', status == 200 and ip == '203.0.113.7', ip)

finish()
