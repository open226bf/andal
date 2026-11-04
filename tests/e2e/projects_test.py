"""Tests de bout en bout: gestion des volumes (créer, modifier, archiver, supprimer)."""
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



aminata, thomas, lea, camille, nora = (login(u) for u in ['aminata', 'thomas', 'lea', 'camille', 'nora'])
ids = dict(line.split('|') for line in sql("select username, id from users").splitlines())

_, every = camille.call('GET', '/projects')
next_number = max(p['volumeNumber'] for p in every) + 1
order = ['paiements', 'identite', 'donnees', 'mobile', 'plateforme', 'design']
least = min(order, key=lambda c: (sum(p['cloth'] == c for p in every), order.index(c)))

print('— Étagère et bibliothèque')
_, mine = aminata.call('GET', '/projects')
check('Aminata voit toute la bibliothèque qui lui est ouverte', len(mine) == 11, len(mine))
check('son étagère porte ses cinq volumes épinglés', sorted(p['slug'] for p in mine if p['pinned']) == sorted(['identite', 'plateforme', 'paiements', 'mobile', 'donnees']), [p['slug'] for p in mine if p['pinned']])
check('chaque volume dit sa dernière activité', all(p['updatedAt'] for p in mine) and next(p for p in mine if p['slug'] == 'onboarding')['updatedAt'] < next(p for p in mine if p['slug'] == 'paiements')['updatedAt'])
obs = next(p for p in mine if p['slug'] == 'observabilite')
status, _ = aminata.call('PUT', f'/projects/{obs["id"]}/pin')
status2, _ = aminata.call('PUT', f'/projects/{obs["id"]}/pin')
_, mine = aminata.call('GET', '/projects')
check('épingler pose le volume sur l’étagère (deux fois sans effet)', status == 204 and status2 == 204 and next(p for p in mine if p['id'] == obs['id'])['pinned'], (status, status2))
_, theirs = thomas.call('GET', '/projects')
check('l’étagère est à chacun: rien ne change pour Thomas', not next(p for p in theirs if p['id'] == obs['id'])['pinned'])
status, _ = aminata.call('DELETE', f'/projects/{obs["id"]}/pin')
_, mine = aminata.call('GET', '/projects')
check('désépingler le rend à la bibliothèque', status == 204 and not next(p for p in mine if p['id'] == obs['id'])['pinned'], status)
rech = next(p for p in every if p['slug'] == 'recherche')
status, _ = aminata.call('PUT', f'/projects/{rech["id"]}/pin')
check('on n’épingle pas un volume fermé', status == 404, status)
_, nora_list = nora.call('GET', '/projects')
check('Nora, invitée, n’a que Paiements, épinglé', [(p['slug'], p['pinned']) for p in nora_list] == [('paiements', True)], [(p['slug'], p['pinned']) for p in nora_list])

print('— Rayons')
_, rayons = aminata.call('GET', '/rayons')
check('tout le monde lit les rayons, dans leur ordre', [r['name'] for r in rayons] == ['Socle technique', 'Produits', 'Design et recherche', 'Équipe'], [r['name'] for r in rayons])
by_name = {r['name']: r['id'] for r in rayons}
check('chaque volume dit son rayon (Données reste hors rayon)', next(p for p in every if p['slug'] == 'paiements')['rayonId'] == by_name['Produits'] and next(p for p in every if p['slug'] == 'donnees')['rayonId'] is None)
status, body = aminata.call('POST', '/rayons', {'name': 'Pirate'})
check('un membre ne crée pas de rayon', status == 403, msg(body))
status, body = camille.call('POST', '/rayons', {'name': ' produits '})
check('deux rayons ne portent pas le même nom', status == 409, msg(body))
status, body = camille.call('POST', '/rayons', {'name': ''})
check('un rayon a un nom', status == 400, msg(body))
status, created_rayon = camille.call('POST', '/rayons', {'name': 'Archives légales'})
rayon_new = created_rayon['id']
_, rayons = aminata.call('GET', '/rayons')
check('Camille ajoute un rayon, à la fin', status == 201 and rayons[-1]['name'] == 'Archives légales', [r['name'] for r in rayons])
status, _ = camille.call('PATCH', f'/rayons/{rayon_new}', {'name': 'Juridique'})
_, rayons = aminata.call('GET', '/rayons')
check('elle le renomme', status == 204 and rayons[-1]['name'] == 'Juridique', status)
order = [r['id'] for r in rayons]
status, body = camille.call('PUT', '/rayons/order', {'ids': order[:-1]})
check('un ordre incomplet est refusé', status == 400, msg(body))
status, _ = camille.call('PUT', '/rayons/order', {'ids': [order[-1], *order[:-1]]})
_, rayons = aminata.call('GET', '/rayons')
check('elle le met en tête', status == 204 and rayons[0]['name'] == 'Juridique', [r['name'] for r in rayons])
donnees = next(p for p in every if p['slug'] == 'donnees')
status, body = aminata.call('PATCH', f'/projects/{donnees["id"]}', {'rayonId': rayon_new})
check('ranger un volume demande d’en être admin', status == 403, msg(body))
status, body = camille.call('PATCH', f'/projects/{donnees["id"]}', {'rayonId': '00000000-0000-4000-8000-000000000000'})
check('un rayon inconnu est refusé', status == 400, msg(body))
status, _ = camille.call('PATCH', f'/projects/{donnees["id"]}', {'rayonId': rayon_new})
_, mine = aminata.call('GET', '/projects')
check('Camille range Données dans Juridique', status == 204 and next(p for p in mine if p['slug'] == 'donnees')['rayonId'] == rayon_new, status)
status, body = aminata.call('DELETE', f'/rayons/{rayon_new}')
check('un membre ne supprime pas de rayon', status == 403, msg(body))
status, _ = camille.call('DELETE', f'/rayons/{rayon_new}')
_, mine = aminata.call('GET', '/projects')
check('supprimer le rayon laisse son volume hors rayon', status == 204 and next(p for p in mine if p['slug'] == 'donnees')['rayonId'] is None, status)
camille.call('PUT', '/rayons/order', {'ids': [by_name[n] for n in ['Socle technique', 'Produits', 'Design et recherche', 'Équipe']]})
audit = sql("select string_agg(action, ',' order by created_at) from audit_events where action like 'rayon.%'")
check('les rayons passent au journal', audit == 'rayon.created,rayon.renamed,rayon.reordered,rayon.deleted,rayon.reordered', audit)

print('— Créer')
status, body = nora.call('POST', '/projects', {'name': 'Prestataires'})
check('une invitée ne crée pas de volume', status == 403, msg(body))
status, body = lea.call('POST', '/projects', {'name': '  '})
check('un nom vide est refusé', status == 400, msg(body))
status, body = lea.call('POST', '/projects', {'name': 'Une équipe au nom vraiment très long'})
check('un nom trop long pour le dos demande un nom court', status == 400, msg(body))
status, body = lea.call('POST', '/projects', {'name': 'Sécurité', 'cloth': 'rose'})
check('une couleur inconnue est refusée', status == 400, msg(body))
status, created = lea.call('POST', '/projects', {'name': 'Données & BI', 'description': 'Tableaux de bord et entrepôt.', 'rayonId': by_name['Produits']})
vol = created['id']
check('Léa crée « Données & BI »', status == 201 and created['slug'] == 'donnees-bi' and created['firstPageId'], created)
_, projects = lea.call('GET', '/projects')
mine = next((p for p in projects if p['id'] == vol), None)
check(f'il prend le numéro {next_number}, Léa en est admin, une page', mine and mine['volumeNumber'] == next_number and mine['role'] == 'admin' and mine['pageCount'] == 1 and mine['firstPageId'] == created['firstPageId'], mine)
check('il arrive épinglé sur l’étagère de Léa, dans son rayon', mine and mine['pinned'] is True and mine['rayonId'] == by_name['Produits'])
check('il prend la toile la moins portée', mine and mine['cloth'] == least, (mine and mine['cloth'], least))
_, page = lea.call('GET', f'/pages/{created["firstPageId"]}')
check('sa première page « Présentation » est modifiable par Léa', page['title'] == 'Présentation' and page['role'] == 'admin', (page['title'], page['role']))
status, twin = lea.call('POST', '/projects', {'name': 'Données & BI', 'shortName': 'BI bis', 'cloth': 'mobile'})
check('même nom → adresse distincte', status == 201 and twin['slug'] == 'donnees-bi-2', twin)
_, projects = aminata.call('GET', '/projects')
check('Aminata ne le voit pas (personne ne le lui a ouvert)', all(p['id'] != vol for p in projects))
status, _ = aminata.call('GET', '/projects/donnees-bi/tree')
check('ni son sommaire', status == 404, status)
_, projects = camille.call('GET', '/projects')
check('Camille, propriétaire de l’espace, le voit', any(p['id'] == vol and p['role'] == 'admin' for p in projects))

print('— Modifier')
status, body = aminata.call('PATCH', f'/projects/{vol}', {'name': 'Piraté'})
check('sans accès → 404', status == 404, status)
lea.call('PUT', f'/projects/{vol}/grants', {'type': 'user', 'id': ids['aminata'], 'role': 'editor'})
status, body = aminata.call('PATCH', f'/projects/{vol}', {'name': 'Piraté'})
check('une rédactrice ne règle pas le volume', status == 403, msg(body))
status, _ = lea.call('PATCH', f'/projects/{vol}', {'name': 'Données et décisionnel', 'shortName': 'Données & BI', 'cloth': 'plateforme', 'description': ''})
_, tree = lea.call('GET', '/projects/donnees-bi/tree')
p = tree['project']
check('Léa le renomme et change sa toile', status == 204 and p['name'] == 'Données et décisionnel' and p['shortName'] == 'Données & BI' and p['cloth'] == 'plateforme' and p['description'] is None, p)
check('son adresse ne change pas', p['slug'] == 'donnees-bi')
status, body = lea.call('PATCH', f'/projects/{vol}', {'shortName': 'Un nom court bien trop long'})
check('nom court trop long → 400', status == 400, msg(body))

print('— Archiver')
status, body = aminata.call('POST', f'/projects/{vol}/archive')
check('une rédactrice n’archive pas', status == 403, msg(body))
status, _ = lea.call('POST', f'/projects/{vol}/archive')
check('Léa archive le volume', status == 204, status)
status, body = lea.call('POST', f'/projects/{vol}/archive')
check('déjà archivé → 409', status == 409, msg(body))
_, projects = lea.call('GET', '/projects')
check('il quitte l’étagère', all(p['id'] != vol for p in projects))
_, tree = lea.call('GET', '/projects/donnees-bi/tree')
check('son sommaire reste lisible, en lecture seule', tree['project']['archived'] and tree['project']['role'] == 'reader' and tree['project']['canManage'] and all(pg['role'] == 'reader' for pg in tree['pages']), tree['project'])
first = created['firstPageId']
_, page = aminata.call('GET', f'/pages/{first}')
check('la rédactrice le lit en lecture seule', page['role'] == 'reader', page['role'])
status, _ = aminata.call('PATCH', f'/pages/{first}', {'title': 'Modifié'})
check('plus de modification de page', status == 403, status)
status, _ = lea.call('POST', f'/projects/{vol}/pages', {'title': 'Nouvelle'})
check('plus de création de page, même pour l’admin', status == 403, status)
status, _ = lea.call('DELETE', f'/pages/{first}')
check('plus de corbeille', status == 403, status)
status, _ = aminata.call('POST', f'/pages/{first}/threads', {'body': 'Un commentaire', 'quote': 'x'})
check('plus de commentaire', status == 403, status)
status, body = lea.call('PUT', f'/projects/{vol}/grants', {'type': 'user', 'id': ids['thomas'], 'role': 'reader'})
check('plus de changement d’accès', status == 409, msg(body))
status, body = lea.call('PATCH', f'/projects/{vol}', {'name': 'Autre'})
check('plus de réglages tant qu’il est archivé', status == 409, msg(body))
_, hits = lea.call('GET', '/search?q=Pr%C3%A9sentation')
check('il sort de la recherche', all(h['project']['slug'] != 'donnees-bi' for h in hits), [h['project']['slug'] for h in hits])
_, archives = lea.call('GET', '/projects/archived')
check('Léa le retrouve dans ses archives', [a['slug'] for a in archives] == ['donnees-bi'] and archives[0]['archivedBy'] == 'Léa M.' and archives[0]['canDelete'] is False, archives)
_, archives = aminata.call('GET', '/projects/archived')
check('pas dans celles d’Aminata, qui ne l’administre pas', archives == [], archives)

print('— Désarchiver et supprimer')
status, body = lea.call('DELETE', f'/projects/{vol}', {'confirm': 'Données & BI'})
check('Léa, membre de l’espace, ne supprime pas', status == 403, msg(body))
status, body = camille.call('DELETE', f'/projects/{twin["id"]}', {'confirm': 'BI bis'})
check('un volume en service ne se supprime pas', status == 409, msg(body))
status, body = camille.call('DELETE', f'/projects/{vol}', {'confirm': 'Données'})
check('mauvaise confirmation → 400', status == 400, msg(body))
status, _ = lea.call('POST', f'/projects/{vol}/unarchive')
_, projects = aminata.call('GET', '/projects')
check('Léa le désarchive: il revient, en écriture', status == 204 and any(p['id'] == vol and p['role'] == 'editor' for p in projects), status)
lea.call('POST', f'/projects/{vol}/archive')
status, body = lea.call('PUT', f'/projects/{vol}/pin')
check('un volume archivé ne s’épingle pas', status == 409, msg(body))
status, _ = camille.call('DELETE', f'/projects/{vol}', {'confirm': 'Données & BI'})
check('Camille le supprime définitivement', status == 204, status)
left = sql(f"select (select count(*) from projects where id = '{vol}') + (select count(*) from pages where project_id = '{vol}') + (select count(*) from project_members where project_id = '{vol}')")
check('volume, pages et droits ont disparu', left == '0', left)
audit = sql(f"select string_agg(action, ',' order by created_at) from audit_events where target_id = '{vol}'")
check('le journal garde toute son histoire', audit == 'project.created,access.grant_added,project.updated,project.archived,project.unarchived,project.archived,project.deleted', audit)
status, _ = lea.call('GET', '/projects/donnees-bi/tree')
check('son adresse ne mène plus nulle part', status == 404, status)
lea.call('POST', f'/projects/{twin["id"]}/archive')
camille.call('DELETE', f'/projects/{twin["id"]}', {'confirm': 'BI bis'})

print(f'\n{"Tout passe" if failures == 0 else f"{failures} échec(s)"}')
sys.exit(1 if failures else 0)
