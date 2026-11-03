"""Fichiers envoyés sur les pages (droits, types, en-têtes, nettoyage) et liens entre pages (rétroliens, recherche, aperçu)."""
import base64
import json
import time
from urllib.parse import quote

from harness import Client, bull, check, finish, login, msg, sql

PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==')
SVG = b'<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script><rect width="10" height="10"/></svg>'

aminata = login('aminata')  # éditrice de Paiements (groupe)
nora = login('nora')  # lectrice de Paiements, invitée, rien sur Plateforme
lea = login('lea')  # commentatrice de Paiements, éditrice de Plateforme

_, paiements = aminata.call('GET', '/projects/paiements/tree')
_, plateforme = lea.call('GET', '/projects/plateforme/tree')
page_a, page_b = paiements['pages'][0]['id'], paiements['pages'][1]['id']
page_p = plateforme['pages'][0]['id']

print('— Envoi de fichiers')
status, image = aminata.upload(f'/pages/{page_a}/files', 'schéma réseau.png', PNG, 'image/png')
check("l'éditrice envoie une image", status == 201 and image['image'] and image['contentType'] == 'image/png', (status, image))
status, note = aminata.upload(f'/pages/{page_a}/files', 'notes.md', b'# Notes\n', 'text/markdown')
check('un fichier texte est une pièce jointe', status == 201 and not note['image'], (status, note))
status, fake = aminata.upload(f'/pages/{page_a}/files', 'piege.png', b'<html><script>alert(1)</script></html>', 'image/png')
check("un faux PNG n'est pas une image (signature lue)", status == 201 and not fake['image'] and fake['contentType'] == 'application/octet-stream', (status, fake))
status, svg = aminata.upload(f'/pages/{page_a}/files', 'logo.svg', SVG, 'image/svg+xml')
check('un SVG est une image', status == 201 and svg['image'], (status, svg))
status, body = aminata.upload(f'/pages/{page_a}/files', '../../etc/passwd', b'x', 'text/plain')
check('le nom perd son chemin', status == 201 and body['name'] == 'passwd', body)
status, body = aminata.upload(f'/pages/{page_a}/files', 'vide.txt', b'', 'text/plain')
check('un fichier vide est refusé', status == 400, (status, msg(body)))
status, body = aminata.upload(f'/pages/{page_a}/files', 'gros.bin', b'0' * (26 * 1024 * 1024))
check('au-delà de 25 Mo: 413', status == 413, (status, msg(body)))
status, _ = nora.upload(f'/pages/{page_a}/files', 'x.png', PNG, 'image/png')
check('une lectrice ne peut pas envoyer (404)', status == 404, status)
status, _ = lea.upload(f'/pages/{page_a}/files', 'x.png', PNG, 'image/png')
check('une commentatrice non plus', status == 404, status)
status, _ = Client().upload(f'/pages/{page_a}/files', 'x.png', PNG, 'image/png')
check('sans session: 401', status == 401, status)
status, body = aminata.call('POST', f'/pages/{page_a}/files', {'file': 'x'})
check('sans multipart: 400', status == 400, (status, msg(body)))

print('— Lecture des fichiers')
status, headers, raw = nora.raw('GET', f'/files/{image["id"]}')
check('la lectrice de la page lit l’image', status == 200 and raw == PNG, status)
check('image affichée dans la page (inline)', headers.get('content-disposition', '').startswith('inline'), headers.get('content-disposition'))
check('mise en cache privée et immuable', 'immutable' in headers.get('cache-control', '') and 'private' in headers.get('cache-control', ''), headers.get('cache-control'))
check('CSP sandbox sur chaque fichier', 'sandbox' in headers.get('content-security-policy', ''), headers.get('content-security-policy'))
check('nosniff', headers.get('x-content-type-options') == 'nosniff')
status, headers, raw = nora.raw('GET', f'/files/{note["id"]}')
check('une pièce jointe se télécharge (attachment)', status == 200 and headers.get('content-disposition', '').startswith('attachment'), headers.get('content-disposition'))
status, headers, _ = nora.raw('GET', f'/files/{fake["id"]}')
check('le faux PNG est téléchargé, jamais affiché', headers.get('content-disposition', '').startswith('attachment'), headers.get('content-disposition'))
status, headers, _ = nora.raw('GET', f'/files/{svg["id"]}')
check('le SVG est servi sous sandbox', 'sandbox' in headers.get('content-security-policy', ''))
status, _ = lea.upload(f'/pages/{page_p}/files', 'infra.png', PNG, 'image/png')
status_p, private = status, _
status, _, _ = nora.raw('GET', f'/files/{private["id"]}')
check("un fichier d'une page illisible répond 404", status_p == 201 and status == 404, status)
status, _, _ = Client().raw('GET', f'/files/{image["id"]}')
check('sans session: 401', status == 401, status)
status, _, _ = nora.raw('GET', '/files/00000000-0000-4000-8000-000000000000')
check('fichier inconnu: 404', status == 404, status)
audit = sql(f"select count(*) from audit_events where action = 'file.uploaded' and target_id = '{image['id']}'")
check("l'envoi est au journal d'audit", audit == '1', audit)

print('— Nettoyage du stockage')
_, draft = aminata.call('POST', f'/projects/{paiements["project"]["id"]}/pages', {'title': 'Brouillon avec fichier'})
_, attached = aminata.upload(f'/pages/{draft["id"]}/files', 'a.png', PNG, 'image/png')
key = sql(f"select storage_key from attachments where id = '{attached['id']}'")
aminata.call('DELETE', f'/pages/{draft["id"]}')
camille = login('camille')
camille.call('DELETE', f'/pages/{draft["id"]}/purge')
check('la purge met l’objet à la corbeille du stockage', sql(f"select count(*) from storage_trash where storage_key = '{key}'") == '1')
bull("await q.add('storage.sweep', {});")
for _ in range(20):
    if sql(f"select count(*) from storage_trash where storage_key = '{key}'") == '0':
        break
    time.sleep(0.5)
check('le worker efface l’objet orphelin', sql(f"select count(*) from storage_trash where storage_key = '{key}'") == '0')
scheduled = json.loads(bull('console.log(JSON.stringify(await q.getJobSchedulers()));').strip().splitlines()[-1])
check('le nettoyage est planifié toutes les heures', any(j['key'] == 'storage-sweep' and j['every'] == 3600 * 1000 for j in scheduled), scheduled)

print('— Liens entre pages')


def link_content(*targets):
    marks = [{'type': 'text', 'text': f'voir {t}', 'marks': [{'type': 'link', 'attrs': {'href': href}}]} for t, href in targets]
    return json.dumps({'type': 'doc', 'content': [{'type': 'paragraph', 'content': marks}]}).replace("'", "''")


def index(page_id):
    bull(f"await q.add('page.index', {{ pageId: '{page_id}' }});")


# A (Paiements) et P (Plateforme) citent B; A cite aussi un site externe et une page inexistante.
sql(f"update pages set content = '{link_content(('B', f'/p/{page_b}'), ('externe', 'https://example.com'), ('fantôme', '/p/00000000-0000-4000-8000-000000000000'))}' where id = '{page_a}'")
sql(f"update pages set content = '{link_content(('B', f'http://localhost:5173/v/paiements/{page_b}?fil=x'))}' where id = '{page_p}'")
index(page_a)
index(page_p)
for _ in range(20):
    if sql(f"select count(*) from page_links where target_id = '{page_b}'") == '2':
        break
    time.sleep(0.5)
check('deux liens relevés vers B (court et adresse collée)', sql(f"select count(*) from page_links where target_id = '{page_b}'") == '2')
check('ni lien externe ni page inexistante', sql(f"select count(*) from page_links where source_id = '{page_a}'") == '1')
_, b_for_lea = lea.call('GET', f'/pages/{page_b}')
check('Léa voit les deux pages qui citent B', sorted(x['id'] for x in b_for_lea['backlinks']) == sorted([page_a, page_p]), b_for_lea['backlinks'])
_, b_for_nora = nora.call('GET', f'/pages/{page_b}')
check('Nora ne voit pas la page de Plateforme qu’elle ne lit pas', [x['id'] for x in b_for_nora['backlinks']] == [page_a], b_for_nora['backlinks'])
sql(f"update pages set content = '{link_content(('externe', 'https://example.com'))}' where id = '{page_a}'")
index(page_a)
for _ in range(20):
    if sql(f"select count(*) from page_links where source_id = '{page_a}'") == '0':
        break
    time.sleep(0.5)
check('retirer le lien retire le rétrolien', sql(f"select count(*) from page_links where source_id = '{page_a}'") == '0')

print('— Recherche de page et aperçu')
title_b = b_for_lea['title']
status, found = nora.call('GET', f'/pages/lookup?q={quote(title_b[:6].upper())}&volume=paiements')
check('recherche par titre, accents et casse ignorés', status == 200 and any(x['id'] == page_b for x in found), found)
_, by_number = aminata.call('GET', f'/pages/lookup?q={b_for_lea["number"]}&volume=paiements')
check('recherche par numéro, volume en cours en tête', by_number and by_number[0]['id'] == page_b, by_number[:2])
title_p = plateforme['pages'][0]['title']
_, hidden = nora.call('GET', f'/pages/lookup?q={quote(title_p)}')
check('jamais une page illisible', all(x['id'] != page_p for x in hidden), hidden)
status, preview = nora.call('GET', f'/pages/{page_b}/preview')
check('aperçu: titre, numéro, volume', status == 200 and preview['title'] == title_b and preview['project']['slug'] == 'paiements' and preview['number'], preview)
status, _ = nora.call('GET', f'/pages/{page_p}/preview')
check('aperçu d’une page illisible: 404', status == 404, status)

finish()
