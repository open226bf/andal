"""Pouvoir migrer: modèles de page, exports (Markdown, PDF, archive du volume), liens publics, imports (Markdown, Notion, Confluence).

Les imports se font dans un volume d'essai, supprimé à la fin; les liens publics créés sur Paiements sont retirés.
"""
import atexit
import base64
import io
import json
import time
import zipfile

from harness import ORIGIN, Client, check, finish, login, msg, sql

PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==')
PDF = b'%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n'

camille = login('camille')  # propriétaire de l'espace: admin de tous les volumes
lea = login('lea')  # commentatrice de Paiements, éditrice de Plateforme
nora = login('nora')  # lectrice de Paiements, invitée
anon = Client()

_, me = lea.call('GET', '/me')
fr = me['user']['locale'] == 'fr'
_, features = camille.call('GET', '/me')
features = features['features']
_, paiements = camille.call('GET', '/projects/paiements/tree')
by_title = {p['title']: p for p in paiements['pages']}
auth_page = by_title['Authentification']
_, nora_tree = nora.call('GET', '/projects/paiements/tree')
nora_ids = {p['id'] for p in nora_tree['pages']}
hidden = [p for p in paiements['pages'] if p['id'] not in nora_ids]


def walk(node, out=None):
    out = [] if out is None else out
    out.append(node)
    for child in node.get('content', []) or []:
        walk(child, out)
    return out


def wait_import(client, import_id):
    body = None
    for _ in range(120):
        _, body = client.call('GET', f'/imports/{import_id}')
        if body and body.get('status') in ('done', 'failed'):
            return body
        time.sleep(0.5)
    return body


def tree_of(client, slug):
    _, tree = client.call('GET', f'/projects/{slug}/tree')
    return tree


# Volume d'essai, créé par Léa (qui en devient admin), supprimé à la fin même si la suite s'arrête en route.
status, vol = lea.call('POST', '/projects', {'name': 'Essai migration', 'shortName': 'Migration'})
assert status == 201, (status, vol)
vol_id, vol_slug = vol['id'], vol['slug']


@atexit.register
def cleanup():
    lea.call('POST', f'/projects/{vol_id}/archive')
    camille.call('DELETE', f'/projects/{vol_id}', {'confirm': 'Migration'})


print('— Modèles de page')
status, created = lea.call('POST', f'/projects/{vol_id}/pages', {'title': 'Runbook : paiements', 'template': 'runbook'})
check('une page part du modèle runbook', status == 201, (status, created))
_, content = lea.call('GET', f"/pages/{created['id']}/content")
types = {n.get('type') for n in walk(content['content'])}
check('elle a son tableau, son encadré, son code et ses cases à cocher', {'table', 'callout', 'codeBlock', 'taskList'} <= types, types)
headings = [''.join(t.get('text', '') for t in n.get('content', [])) for n in content['content']['content'] if n['type'] == 'heading']
check('dans la langue de son autrice', ('Diagnostic' if fr else 'Diagnosis') in headings, headings)
status, body = lea.call('POST', f'/projects/{vol_id}/pages', {'title': 'X', 'template': 'inconnu'})
check('un modèle inconnu est refusé', status == 400 and 'adr' in msg(body), (status, msg(body)))
for template in ('adr', 'rfc', 'postmortem'):
    status, _ = lea.call('POST', f'/projects/{vol_id}/pages', {'title': f'Modèle {template}', 'template': template})
    check(f'le modèle {template} se crée', status == 201, status)
audit = sql(f"select metadata->>'template' from audit_events where action = 'page.created' and target_id = '{created['id']}'")
check('le journal note le modèle', audit.strip() == 'runbook', audit)

print('— Export Markdown d’une page')
status, headers, raw = nora.raw('GET', f"/pages/{auth_page['id']}/export")
text = raw.decode()
check('une lectrice exporte la page en Markdown', status == 200 and headers.get('content-type', '').startswith('text/markdown'), status)
check('en pièce jointe, au nom de la page', 'attachment' in headers.get('content-disposition', '') and 'Authentification.md' in headers.get('content-disposition', ''), headers.get('content-disposition'))
check('le titre en tête, les liens internes en adresses complètes', text.startswith('# Authentification') and f'{ORIGIN}/p/' in text, text[:200])
status, _, _ = anon.raw('GET', f"/pages/{auth_page['id']}/export")
check('sans session: 401', status == 401, status)
if hidden:
    status, _, _ = nora.raw('GET', f"/pages/{hidden[0]['id']}/export")
    check('une page qu’elle ne lit pas: 404', status == 404, status)
status, body = nora.call('GET', f"/pages/{auth_page['id']}/export?format=docx")
check('un format inconnu est refusé', status == 400, (status, msg(body)))

print('— Export PDF')
status, headers, raw = nora.raw('GET', f"/pages/{auth_page['id']}/export?format=pdf")
if features['pdf']:
    check('le PDF sort, mis en page par Gotenberg', status == 200 and raw[:5] == b'%PDF-' and headers.get('content-type') == 'application/pdf', (status, raw[:40]))
    check('nommé d’après le numéro et le titre', '3.2%20Authentification.pdf' in headers.get('content-disposition', ''), headers.get('content-disposition'))
    check('l’export PDF est journalisé', sql(f"select count(*) from audit_events where action = 'page.exported' and target_id = '{auth_page['id']}'").strip() != '0')
else:
    check('sans Gotenberg: 503', status == 503, status)

print('— Export du volume')
status, headers, raw = nora.raw('GET', f"/projects/{paiements['project']['id']}/export")
check('une lectrice exporte le volume en archive', status == 200 and headers.get('content-type') == 'application/zip', status)
archive = zipfile.ZipFile(io.BytesIO(raw))
names = archive.namelist()
check('une page par fichier, un dossier par page parente', any(n.endswith('/index.md') for n in names) and all(n.startswith('plateforme-paiements/') for n in names), names[:5])
check('les pages qu’elle ne lit pas n’y sont pas', len([n for n in names if n.endswith('.md')]) == len(nora_ids), (len(names), len(nora_ids)))
auth_md = next(n for n in names if n.endswith('-authentification.md'))
auth_text = archive.read(auth_md).decode()
check('titre et position dans l’en-tête YAML', auth_text.startswith('---\ntitle: "Authentification"\nposition: '), auth_text[:80])
check('les liens entre pages en chemins relatifs', '](04-jetons-utilisateur.md)' in auth_text, [l for l in auth_text.splitlines() if 'jetons' in l.lower()][:2])
status, _, _ = Client().raw('GET', f"/projects/{paiements['project']['id']}/export")
check('sans session: 401', status == 401, status)

print('— Liens publics')
arch = by_title['Architecture']
status, body = lea.call('POST', '/public-links', {'pageId': arch['id']})
check('une commentatrice ne publie pas (403)', status == 403, (status, msg(body)))
status, st = nora.call('GET', f"/pages/{arch['id']}/public-links")
check('une lectrice voit l’état, sans pouvoir le changer', status == 200 and st['canManage'] is False and st['enabled'] is True, st)
status, link = camille.call('POST', '/public-links', {'pageId': arch['id'], 'subpages': True})
check('un admin du volume publie la page et ses sous-pages', status == 201 and link['url'].endswith(f"/s/{link['token']}"), (status, link))
status, shared = anon.call('GET', f"/public/{link['token']}")
sub = [p for p in paiements['pages'] if p['parentId'] == arch['id']]
check('sans compte: la page et ses sous-pages, rien d’autre', status == 200 and {p['id'] for p in shared['pages']} == {arch['id'], *[p['id'] for p in sub]}, (status, shared))
status, _ = anon.call('GET', f"/public/{link['token']}/pages/{auth_page['id']}")
check('une page hors du partage: 404', status == 404, status)
status, again = camille.call('POST', '/public-links', {'pageId': arch['id'], 'subpages': False})
check('republier met à jour le même lien', status == 201 and again['token'] == link['token'] and again['subpages'] is False, again)
_, shared = anon.call('GET', f"/public/{link['token']}")
check('sans ses sous-pages, la page seule', [p['id'] for p in shared['pages']] == [arch['id']], shared['pages'])
if hidden:
    status, body = camille.call('POST', '/public-links', {'pageId': hidden[0]['id']})
    check('une page restreinte en lecture ne se publie pas (409)', status == 409, (status, msg(body)))
status, volume_link = camille.call('POST', '/public-links', {'projectId': paiements['project']['id']})
check('tout le volume se publie', status == 201 and volume_link['page'] is None, volume_link)
_, shared = anon.call('GET', f"/public/{volume_link['token']}")
shared_ids = {p['id'] for p in shared['pages']}
check('les pages restreintes en lecture n’y sont pas', all(p['id'] not in shared_ids for p in hidden) and auth_page['id'] in shared_ids, (len(shared_ids), [p['title'] for p in hidden]))
status, page = anon.call('GET', f"/public/{volume_link['token']}/pages/{auth_page['id']}")
nodes = walk(page['content'])
marks = [m for n in nodes for m in n.get('marks', [])]
hrefs = [m['attrs']['href'] for m in marks if m['type'] == 'link']
check('ni ancre de commentaire, ni historique', status == 200 and all(m['type'] != 'comment' for m in marks), [m['type'] for m in marks])
check('un lien vers une page du partage passe par le partage', any(h.startswith(f"/s/{volume_link['token']}/") for h in hrefs), hrefs)
check('un lien vers une page hors du partage perd son adresse', all(not h.startswith('/p/') and '/v/' not in h for h in hrefs), hrefs)
status, st = camille.call('GET', f"/pages/{auth_page['id']}/public-links")
check('le panneau Partager montre le lien qui couvre la page', status == 200 and [l['page'] for l in st['links']] == [None], st)
status, _ = lea.call('DELETE', f"/public-links/{volume_link['id']}")
check('une commentatrice ne retire pas un lien (403)', status == 403, status)
for l in (link, volume_link):
    camille.call('DELETE', f"/public-links/{l['id']}")
status, _ = anon.call('GET', f"/public/{volume_link['token']}")
check('un lien retiré ne mène plus nulle part', status == 404, status)
status, _ = anon.call('GET', '/public/pas-un-jeton-valide-du-tout')
check('un jeton inconnu: 404', status == 404, status)
check('création et retrait sont journalisés', sql("select count(*) from audit_events where action in ('public_link.created', 'public_link.removed')").strip() not in ('', '0'))

# Fichier d'une page publiée: servi par le lien, et seulement celui-là.
_, vtree = lea.call('GET', f'/projects/{vol_slug}/tree')
first = vtree['pages'][0]['id']
status, image = lea.upload(f'/pages/{first}/files', 'schema.png', PNG, 'image/png')
status, page_link = lea.call('POST', '/public-links', {'pageId': first, 'subpages': False})
check('Léa, admin de son volume, publie une page', status == 201, (status, page_link))
status, headers, raw = anon.raw('GET', f"/public/{page_link['token']}/files/{image['id']}")
check('un fichier de la page publiée se lit sans compte', status == 200 and raw == PNG and 'sandbox' in headers.get('content-security-policy', ''), status)
other = next(p['id'] for p in vtree['pages'] if p['id'] != first)
_, other_file = lea.upload(f'/pages/{other}/files', 'autre.png', PNG, 'image/png')
status, _, _ = anon.raw('GET', f"/public/{page_link['token']}/files/{other_file['id']}")
check('un fichier d’une autre page: 404', status == 404, status)
lea.call('DELETE', f"/public-links/{page_link['id']}")

print('— Import: archive d’Andal (aller-retour)')
status, imp = lea.upload(f'/projects/{vol_id}/imports', 'plateforme-paiements.zip', raw_zip := nora.raw('GET', f"/projects/{paiements['project']['id']}/export")[2], 'application/zip')
check('l’import part au worker', status == 201 and imp['status'] in ('pending', 'running'), (status, imp))
done = wait_import(lea, imp['id'])
check('il aboutit', done['status'] == 'done' and done['source'] == 'markdown', done)
md_count = len([n for n in zipfile.ZipFile(io.BytesIO(raw_zip)).namelist() if n.endswith('.md')])
check('une page par fichier Markdown', done['pages'] == md_count, (done['pages'], md_count))
tree = tree_of(lea, vol_slug)
imported = {p['title']: p for p in tree['pages']}
api_page = imported.get('API')
check('la hiérarchie revient: « Authentification » sous « API »', api_page and imported.get('Authentification', {}).get('parentId') == api_page['id'], list(imported)[:12])
_, content = lea.call('GET', f"/pages/{imported['Authentification']['id']}/content")
links = [m['attrs']['href'] for n in walk(content['content']) for m in n.get('marks', []) if m['type'] == 'link']
check('les liens entre pages pointent vers les pages importées', f"/p/{imported['Jetons utilisateur']['id']}" in links, links)
check('les diagrammes Mermaid et les tableaux reviennent', {'mermaid', 'table'} <= {n.get('type') for n in walk(content['content'])})
check('l’archive quitte le stockage', sql(f"select count(*) from imports where id = '{imp['id']}' and status = 'done'").strip() == '1')

print('— Import: export Notion')
notion = io.BytesIO()
with zipfile.ZipFile(notion, 'w') as z:
    gid, cid, tid, rid = 'a' * 32, 'b' * 32, 'c' * 32, 'd' * 32
    z.writestr(f'Export-123/Guide {gid}.md', f'# Guide\n\nVoir [Sous-page](Guide%20{gid}/Sous-page%20{cid}.md).\n\n![Schéma](Guide%20{gid}/schema.png)\n\n<aside>\n💡 Pensez à relire.\n</aside>\n')
    z.writestr(f'Export-123/Guide {gid}/Sous-page {cid}.md', '# Sous-page\n\n- [x] fait\n- [ ] à faire\n')
    z.writestr(f'Export-123/Guide {gid}/schema.png', PNG)
    z.writestr(f'Export-123/Tâches {tid}.csv', 'Nom,État\nMigrer,"En cours"\n')
    z.writestr(f'Export-123/Tâches {tid}/Migrer {rid}.md', '# Migrer\n\nÉtat: En cours\n')
status, imp = lea.upload(f'/projects/{vol_id}/imports', 'Export-123.zip', notion.getvalue(), 'application/zip')
done = wait_import(lea, imp['id'])
check('l’export Notion est reconnu', done['status'] == 'done' and done['source'] == 'notion', done)
tree = tree_of(lea, vol_slug)
imported = {p['title']: p for p in tree['pages']}
check('« Page.md » + dossier « Page/ »: une page et ses sous-pages', imported.get('Sous-page', {}).get('parentId') == imported.get('Guide', {}).get('id'), [(p['title'], p['parentId']) for p in tree['pages']][-6:])
check('une base Notion devient une page-tableau, ses lignes dessous', imported.get('Migrer', {}).get('parentId') == imported.get('Tâches', {}).get('id'), list(imported)[-6:])
_, guide = lea.call('GET', f"/pages/{imported['Guide']['id']}/content")
gnodes = walk(guide['content'])
check('l’image part dans le stockage', any(n['type'] == 'image' and n['attrs']['fileId'] for n in gnodes), [n['type'] for n in gnodes])
check('l’encadré <aside> devient un encadré', any(n['type'] == 'callout' for n in gnodes), [n['type'] for n in gnodes])
check('le lien vers la sous-page devient un lien interne', any(m['attrs']['href'] == f"/p/{imported['Sous-page']['id']}" for n in gnodes for m in n.get('marks', []) if m['type'] == 'link'))
_, table = lea.call('GET', f"/pages/{imported['Tâches']['id']}/content")
check('le CSV devient un tableau', any(n['type'] == 'table' for n in walk(table['content'])))

print('— Import: export HTML de Confluence')
INDEX = '''<html><head><title>Plateforme</title></head><body><div id="main-content"></div>
<div class="pageSection"><h2 id="pages">Available Pages:</h2></div>
<ul><li><a href="Accueil_1.html">Accueil</a><ul><li><a href="Deploiement_2.html">Déploiement</a></li></ul></li></ul></body></html>'''


def confluence_page(title, body):
    return f'''<html><head><title>PLAT : {title}</title></head><body>
<div id="breadcrumb-section"></div><h1 id="title-heading"><span id="title-text">PLAT : {title}</span></h1>
<div id="main-content" class="wiki-content group">{body}</div>
<div class="pageSection group"><h2 id="attachments">Attachments:</h2><div class="greybox"><a href="attachments/2/4.pdf">procedure.pdf</a></div></div>
</body></html>'''


HOME = confluence_page('Accueil', '<p>Bienvenue. Voir <a href="Deploiement_2.html">le déploiement</a>.</p>'
                       '<div class="confluence-information-macro confluence-information-macro-warning"><p class="title">Attention</p>'
                       '<div class="confluence-information-macro-body"><p>Jamais le vendredi.</p></div></div>')
DEPLOY = confluence_page('Déploiement', '<div class="code panel"><div class="codeContent"><pre class="syntaxhighlighter-pre" data-syntaxhighlighter-params="brush: java; gutter: false">class A {}</pre></div></div>'
                         '<table class="confluenceTable"><tbody><tr><th>Étape</th><th>Qui</th></tr><tr><td><p>Build</p></td><td>CI</td></tr></tbody></table>'
                         '<ul class="inline-task-list"><li class="checked">Tests</li><li>Prod</li></ul>'
                         '<p><span class="confluence-embedded-file-wrapper"><img class="confluence-embedded-image" src="attachments/2/3.png" alt="archi"></span></p>')
confluence = io.BytesIO()
with zipfile.ZipFile(confluence, 'w') as z:
    z.writestr('PLAT/index.html', INDEX)
    z.writestr('PLAT/Accueil_1.html', HOME)
    z.writestr('PLAT/Deploiement_2.html', DEPLOY)
    z.writestr('PLAT/attachments/2/3.png', PNG)
    z.writestr('PLAT/attachments/2/4.pdf', PDF)
    z.writestr('PLAT/images/icons/bullet_blue.gif', b'GIF89a')
    z.writestr('../evil.md', '# Évasion\n')
status, imp = lea.upload(f'/projects/{vol_id}/imports', 'PLAT.zip', confluence.getvalue(), 'application/zip', fields={'parentId': first})
done = wait_import(lea, imp['id'])
check('l’export Confluence est reconnu', done['status'] == 'done' and done['source'] == 'confluence', done)
tree = tree_of(lea, vol_slug)
imported = {p['title']: p for p in tree['pages']}
check('rangé sous la page choisie, hiérarchie de l’index gardée', imported.get('Accueil', {}).get('parentId') == first and imported.get('Déploiement', {}).get('parentId') == imported.get('Accueil', {}).get('id'), [(p['title'], p['parentId']) for p in tree['pages']][-4:])
check('une entrée « ../ » du zip est ignorée', 'Évasion' not in imported)
_, home = lea.call('GET', f"/pages/{imported['Accueil']['id']}/content")
hnodes = walk(home['content'])
check('la macro « warning » devient un encadré Attention', any(n['type'] == 'callout' and n['attrs']['tone'] == 'warning' and n['attrs']['title'] == 'Attention' for n in hnodes), [n.get('attrs') for n in hnodes if n['type'] == 'callout'])
check('le lien entre pages devient un lien interne', any(m['attrs']['href'] == f"/p/{imported['Déploiement']['id']}" for n in hnodes for m in n.get('marks', []) if m['type'] == 'link'))
check('les pièces jointes listées sous la page sont reprises, sous leur nom', any(n['type'] == 'attachment' and n['attrs']['name'] == 'procedure.pdf' for n in hnodes), [n.get('attrs') for n in hnodes if n['type'] == 'attachment'])
_, deploy = lea.call('GET', f"/pages/{imported['Déploiement']['id']}/content")
dnodes = walk(deploy['content'])
check('le code garde son langage', any(n['type'] == 'codeBlock' and n['attrs']['language'] == 'java' for n in dnodes), [n.get('attrs') for n in dnodes if n['type'] == 'codeBlock'])
check('tableau, cases à cocher et image', {'table', 'taskList', 'image'} <= {n['type'] for n in dnodes}, {n['type'] for n in dnodes})
check('les icônes de l’interface Confluence ne sont pas importées', sql(f"select count(*) from attachments a join pages p on p.id = a.page_id where p.project_id = '{vol_id}' and a.name like '%.gif'").strip() == '0')

print('— Import: cas limites')
status, imp = lea.upload(f'/projects/{vol_id}/imports', 'note.md', '# Note seule\n\nUn paragraphe.\n'.encode(), 'text/markdown')
done = wait_import(lea, imp['id'])
check('un fichier .md seul donne une page', done['status'] == 'done' and done['pages'] == 1, done)
status, body = lea.upload(f'/projects/{vol_id}/imports', 'virus.exe', b'MZ', 'application/octet-stream')
check('un autre format est refusé', status == 400, (status, msg(body)))
status, imp = lea.upload(f'/projects/{vol_id}/imports', 'faux.zip', b'pas un zip', 'application/zip')
done = wait_import(lea, imp['id']) if status == 201 else {'status': 'refusé'}
check('une archive illisible échoue proprement', done['status'] == 'failed' and done['error'], done)
status, body = nora.upload(f"/projects/{paiements['project']['id']}/imports", 'note.md', b'# x\n', 'text/markdown')
check('une lectrice n’importe pas (403)', status == 403, (status, msg(body)))
status, body = lea.upload(f"/projects/{paiements['project']['id']}/imports", 'note.md', b'# x\n', 'text/markdown', fields={'parentId': first})
check('une destination d’un autre volume est refusée', status in (400, 404), (status, msg(body)))
aminata = login('aminata')
status, _ = aminata.call('GET', f"/imports/{imp['id']}")
check('l’état d’un import ne regarde que son auteur et les admins du volume', status == 404, status)
check('début et fin d’import sont journalisés', sql(f"select count(*) from audit_events where action in ('import.started', 'import.finished') and target_id = '{vol_id}'").strip() not in ('', '0'))

# Ménage: le volume d'essai part (archivé, puis supprimé par l'admin de l'espace).
cleanup()
check('le volume d’essai est supprimé', sql(f"select count(*) from projects where id = '{vol_id}'") == '0')

finish()
