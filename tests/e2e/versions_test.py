"""Tests de bout en bout: historique des versions, suppression définitive, purge automatique."""
import http.cookiejar
import json
import os
import subprocess
import sys
import time
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


def sql(query):
    out = subprocess.run(['docker', 'compose', 'exec', '-T', 'postgres', 'psql', '-U', 'calepin', '-d', os.environ.get('POSTGRES_DB', 'calepin'), '-Atc', query], cwd=ROOT, capture_output=True, text=True, check=True)
    return out.stdout.strip()


failures = 0


def check(label, ok, detail=''):
    global failures
    print(('OK   ' if ok else 'ÉCHEC') + f' {label}' + (f' — {detail}' if detail else ''))
    failures += 0 if ok else 1


def msg(body):
    return body.get('message') if isinstance(body, dict) else body


def kinds(content):
    found = []

    def walk(node):
        found.append(node.get('type'))
        for child in node.get('content', []) or []:
            walk(child)

    walk(content)
    return found


aminata, thomas, lea, camille = (login(u) for u in ['aminata', 'thomas', 'lea', 'camille'])
_, t = aminata.call('GET', '/projects/paiements/tree')
project = t['project']['id']
pages = {p['title']: p for p in t['pages']}
auth = pages['Authentification']['id']

print('— Historique: lecture')
status, versions = lea.call('GET', f'/pages/{auth}/versions')
check('une commentatrice voit l’historique', status == 200 and versions[0]['current'] and versions[0]['version'] == 14, [v['version'] for v in versions][:3])
v13 = next(v for v in versions if v['version'] == 13)
check('la v13 est de Thomas', [a['name'] for a in v13['authors']] == ['Thomas R.'], [a['name'] for a in v13['authors']])
_, old = lea.call('GET', f'/pages/{auth}/versions/13')
_, now = lea.call('GET', f'/pages/{auth}/versions/14')
check('la v13 n’a pas le schéma draw.io, la v14 si', 'drawio' not in kinds(old['content']) and 'drawio' in kinds(now['content']))
status, _ = lea.call('GET', f'/pages/{auth}/versions/999')
check('version inconnue → 404', status == 404)
status, _ = Client().call('GET', f'/pages/{auth}/versions')
check('sans session → 401', status == 401)

print('— Historique: restauration')
status, body = lea.call('POST', f'/pages/{auth}/versions/13/restore')
check('une commentatrice ne restaure pas', status == 403, msg(body))
status, body = aminata.call('POST', f'/pages/{auth}/versions/14/restore')
check('restaurer la version actuelle → 409', status == 409, msg(body))
status, body = aminata.call('POST', f'/pages/{auth}/versions/13/restore')
check('Aminata restaure la v13', status == 201 and body['version'] == 15, body)
_, page = aminata.call('GET', f'/pages/{auth}')
check('la page a repris le contenu de la v13', page['version'] == 15 and 'drawio' not in kinds(page['content']), page['version'])
_, versions = aminata.call('GET', f'/pages/{auth}/versions')
check('la v15 est actuelle, au nom d’Aminata', versions[0]['version'] == 15 and versions[0]['current'] and [a['name'] for a in versions[0]['authors']] == ['Aminata K.'], [a['name'] for a in versions[0]['authors']])
check('la v14 reste dans l’historique', any(v['version'] == 14 and not v['current'] for v in versions))
status, body = aminata.call('POST', f'/pages/{auth}/versions/13/restore')
check('restaurer un contenu identique → 409', status == 409, msg(body))
status, body = thomas.call('POST', f'/pages/{auth}/versions/14/restore')
check('Thomas revient à la v14, nouvelle version 16', status == 201 and body['version'] == 16, body)
_, page = thomas.call('GET', f'/pages/{auth}')
check('le schéma draw.io est revenu', 'drawio' in kinds(page['content']))
audit = sql(f"select count(*) from audit_events where action = 'page.version_restored' and target_id = '{auth}'")
check('les restaurations sont au journal', audit == '2', audit)

print('— Historique: séances de travail')
status, created = aminata.call('POST', f'/projects/{project}/pages', {'title': 'Brouillon'})
draft = created['id']
_, versions = aminata.call('GET', f'/pages/{draft}/versions')
check('une page neuve a sa v1', [v['version'] for v in versions] == [1])
aminata.call('PATCH', f'/pages/{draft}', {'title': 'Brouillon 2'})
thomas.call('PATCH', f'/pages/{draft}', {'title': 'Brouillon 3'})
_, versions = aminata.call('GET', f'/pages/{draft}/versions')
check('deux renommages rapprochés restent dans la v1, à deux noms', [v['version'] for v in versions] == [1] and len(versions[0]['authors']) == 2 and versions[0]['title'] == 'Brouillon 3', versions)
sql(f"update page_versions set updated_at = now() - interval '11 minutes' where page_id = '{draft}'")
thomas.call('PATCH', f'/pages/{draft}', {'title': 'Brouillon final'})
_, versions = aminata.call('GET', f'/pages/{draft}/versions')
check('après 10 minutes de silence, une v2 commence', [v['version'] for v in versions] == [2, 1] and versions[0]['authors'][0]['name'] == 'Thomas R.', [(v['version'], v['title']) for v in versions])
status, body = aminata.call('POST', f'/pages/{draft}/versions/1/restore')
_, page = aminata.call('GET', f'/pages/{draft}')
check('restaurer une version au titre différent reprend le titre', status == 201 and page['title'] == 'Brouillon 3' and page['version'] == 3, (status, page['title'], page['version']))

print('— Corbeille: suppression définitive')
status, created = aminata.call('POST', f'/projects/{project}/pages', {'title': 'Sous-brouillon', 'parentId': draft})
child = created['id']
aminata.call('DELETE', f'/pages/{draft}')
_, trash = aminata.call('GET', f'/projects/{project}/trash')
entry = next(e for e in trash if e['id'] == draft)
check('la corbeille donne la date de purge', entry['purgeAt'][:10] > entry['deletedAt'][:10] and entry['canPurge'] is False, (entry['deletedAt'], entry['purgeAt']))
_, trash = camille.call('GET', f'/projects/{project}/trash')
check('une admin du volume peut purger', next(e for e in trash if e['id'] == draft)['canPurge'] is True)
status, body = aminata.call('DELETE', f'/pages/{draft}/purge')
check('une rédactrice ne purge pas', status == 403, msg(body))
status, body = camille.call('DELETE', f'/pages/{pages["Webhooks"]["id"]}/purge')
check('une page hors corbeille ne se purge pas', status == 404, msg(body))
status, body = lea.call('DELETE', f'/pages/{draft}/purge')
check('une commentatrice ne purge pas', status in (403, 404), status)
status, _ = camille.call('DELETE', f'/pages/{draft}/purge')
check('Camille supprime définitivement la branche', status == 204, status)
left = sql(f"select count(*) from pages where id in ('{draft}', '{child}')")
gone = sql(f"select count(*) from page_versions where page_id in ('{draft}', '{child}')")
check('la page, sa sous-page et leurs versions ont disparu', left == '0' and gone == '0', (left, gone))
_, trash = camille.call('GET', f'/projects/{project}/trash')
check('la corbeille ne la montre plus', all(e['id'] != draft for e in trash))
status, _ = camille.call('POST', f'/pages/{draft}/restore')
check('plus rien à restaurer', status == 404, status)
audit = sql(f"select count(*) from audit_events where action = 'page.purged' and target_id = '{draft}'")
check('la purge est au journal', audit == '1', audit)

print('— Corbeille: purge automatique')
_, old = aminata.call('POST', f'/projects/{project}/pages', {'title': 'Vieux brouillon'})
_, recent = aminata.call('POST', f'/projects/{project}/pages', {'title': 'Brouillon récent'})
aminata.call('DELETE', f'/pages/{old["id"]}')
aminata.call('DELETE', f'/pages/{recent["id"]}')
sql(f"update pages set deleted_at = now() - interval '31 days' where id = '{old['id']}'")


def bull(code):
    return subprocess.run(['pnpm', '--filter', '@andal/worker', 'exec', 'node', '--input-type=module', '-e',
                           f"import {{ Queue }} from 'bullmq'; const q = new Queue('andal', {{ connection: {{ host: '127.0.0.1', port: {os.environ.get('VALKEY_PORT', '56379')} }} }}); " + code + " await q.close();"],
                          cwd=ROOT, check=True, capture_output=True, text=True).stdout


bull("await q.add('trash.purge', {});")
for _ in range(20):
    if sql(f"select count(*) from pages where id = '{old['id']}'") == '0':
        break
    time.sleep(0.5)
check('la page à la corbeille depuis 31 jours est purgée', sql(f"select count(*) from pages where id = '{old['id']}'") == '0')
check('celle d’hier reste', sql(f"select count(*) from pages where id = '{recent['id']}'") == '1')
audit = sql(f"select count(*) from audit_events where action = 'page.purged_automatically' and target_id = '{old['id']}'")
check('la purge automatique est au journal', audit == '1', audit)
camille.call('DELETE', f'/pages/{recent["id"]}/purge')
scheduled = json.loads(bull("console.log(JSON.stringify(await q.getJobSchedulers()));").strip().splitlines()[-1])
check('la purge est planifiée toutes les 6 heures', any(j['key'] == 'trash-purge' and j['every'] == 6 * 3600 * 1000 for j in scheduled), scheduled)

print(f'\n{"Tout passe" if failures == 0 else f"{failures} échec(s)"}')
sys.exit(1 if failures else 0)
