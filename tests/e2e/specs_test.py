"""Specs OpenAPI d'un volume: publication versionnée (YAML, JSON, multipart), lecture, opérations, droits, suppression."""
import json
from urllib.error import URLError
from urllib.parse import quote

from harness import Client, check, finish, login, msg, sql

aminata = login('aminata')  # éditrice de Paiements
nora = login('nora')  # lectrice de Paiements, rien sur Plateforme
lea = login('lea')  # commentatrice de Paiements
camille = login('camille')  # propriétaire de l'espace, admin de tous les volumes

_, shelf = aminata.call('GET', '/projects')
paiements = next(p['id'] for p in shelf if p['slug'] == 'paiements')
plateforme = next(p['id'] for p in shelf if p['slug'] == 'plateforme')

YAML = """openapi: 3.0.3
info:
  title: API Webhooks
  version: '1.0'
paths:
  /webhooks:
    get:
      summary: Liste les abonnements
      responses:
        '200': { description: Les abonnements }
    post:
      summary: Abonne une URL
      requestBody:
        content:
          application/json:
            schema: { $ref: '#/components/schemas/Abonnement' }
      responses:
        '201': { description: Créé }
components:
  schemas:
    Abonnement:
      type: object
      required: [url]
      properties:
        url: { type: string, format: uri, description: Reçoit les événements. }
""".encode()

print('— Lecture de la spec de démo')
status, listing = nora.call('GET', f'/projects/{paiements}/specs')
demo = next((s for s in (listing or {}).get('specs', []) if s['name'] == 'paiements'), None)
check('une lectrice voit les specs du volume', status == 200 and demo is not None and demo['sequence'] == 2 and demo['label'] == '2.3', listing)
check('…sans pouvoir publier', listing and listing['canPublish'] is False)
check("le compte d'opérations vient de la dernière version", demo and demo['operationCount'] == 5, demo)
status, detail = nora.call('GET', f"/specs/{demo['id']}")
check("deux versions, la plus récente d'abord", status == 200 and [v['label'] for v in detail['versions']] == ['2.3', '2.2'], detail)
status, doc = nora.call('GET', f"/specs/{demo['id']}/document?version=1")
check('la version 1 se relit telle quelle', status == 200 and doc['info']['version'] == '2.2' and '/paiements/{id}/remboursements' not in doc['paths'])
status, ops = nora.call('GET', f"/specs/{demo['id']}/operations")
check('les opérations de la dernière version', status == 200 and 'POST /paiements/{id}/remboursements' in [o['key'] for o in ops], ops)
status, op = nora.call('GET', f"/specs/{demo['id']}/operation?key={quote('POST /oauth/token')}")
check("l'opération normalisée pour le bloc", status == 200 and op['operation']['contentType'] == 'application/x-www-form-urlencoded' and op['label'] == '2.3', op)
status, body = nora.call('GET', f"/specs/{demo['id']}/operation?key={quote('POST /paiements/{id}/remboursements')}&version=1")
check("une opération absente d'une version: 404 explicite", status == 404 and "n'existe plus" in msg(body), (status, msg(body)))
status_other, _ = Client().call('GET', f"/specs/{demo['id']}")
check('sans session: 401', status_other == 401, status_other)

print('— Publication')
status, body = aminata.call('POST', f'/projects/{paiements}/specs?name=webhooks', None)
check('un corps vide est refusé', status == 400, (status, msg(body)))
status, _, raw = aminata.raw('POST', f'/projects/{paiements}/specs?name=webhooks', YAML, {'content-type': 'application/yaml'})
created = json.loads(raw)
check("l'éditrice publie du YAML brut", status == 201 and created['sequence'] == 1 and created['title'] == 'API Webhooks' and not created['unchanged'], created)
status, _, raw = aminata.raw('POST', f'/projects/{paiements}/specs?name=webhooks', YAML, {'content-type': 'application/yaml'})
again = json.loads(raw)
check('republier la même spec ne crée pas de version', status == 201 and again['unchanged'] and again['sequence'] == 1, again)
changed = YAML.replace(b"version: '1.0'", b"version: '1.1'")
status, again = aminata.upload(f'/projects/{paiements}/specs', 'Webhooks.yaml', changed, 'application/yaml')
check('multipart: le nom vient du fichier, nouvelle version', status == 201 and again['name'] == 'webhooks' and again['sequence'] == 2 and again['label'] == '1.1', again)
status, body = aminata.call('POST', f"/projects/{paiements}/specs?name={quote('Événements internes')}", {'openapi': '3.1.0', 'info': {'title': 'Événements', 'version': '0.1'}, 'paths': {}})
check('JSON: le nom est normalisé', status == 201 and body['name'] == 'evenements-internes', body)
status, body = aminata.call('POST', f'/projects/{paiements}/specs?name=vieux', {'swagger': '2.0', 'info': {'title': 'x'}, 'paths': {}})
check('Swagger 2 est refusé avec une explication', status == 400 and 'Swagger 2' in msg(body), (status, msg(body)))
status, _, raw = aminata.raw('POST', f'/projects/{paiements}/specs?name=casse', b'openapi: [3\n  info', {'content-type': 'application/yaml'})
check('un YAML cassé est refusé', status == 400, (status, raw[:120]))
bomb = b'a: &a ["x","x","x","x","x","x","x","x","x"]\n' + b''.join(f'{chr(98 + i)}: &{chr(98 + i)} [*{chr(97 + i)},*{chr(97 + i)},*{chr(97 + i)},*{chr(97 + i)},*{chr(97 + i)},*{chr(97 + i)},*{chr(97 + i)},*{chr(97 + i)},*{chr(97 + i)}]\n'.encode() for i in range(8))
status, _, raw = aminata.raw('POST', f'/projects/{paiements}/specs?name=bombe', bomb, {'content-type': 'application/yaml'})
check('les ancres YAML en cascade sont refusées', status == 400, (status, raw[:160]))
try:
    status, _, raw = aminata.raw('POST', f'/projects/{paiements}/specs?name=gros', b'openapi: 3.0.0\n' + b'# ' + b'x' * (2 * 1024 * 1024 + 10), {'content-type': 'application/yaml'})
except URLError:
    status = 'coupée'  # Fastify répond 413 puis ferme sans lire la suite du corps.
check('au-delà de 2 Mo: refusée (413 ou connexion coupée)', status in (413, 'coupée'), status)
status, _ = lea.call('POST', f'/projects/{paiements}/specs?name=x', {'openapi': '3.0.0', 'info': {'title': 'x'}, 'paths': {}})
check('une commentatrice ne publie pas (403)', status == 403, status)
status, _ = nora.call('POST', f'/projects/{plateforme}/specs?name=x', {'openapi': '3.0.0', 'info': {'title': 'x'}, 'paths': {}})
check('un volume fermé répond 404', status == 404, status)
status, _ = nora.call('GET', f'/projects/{plateforme}/specs')
check('…en lecture aussi', status == 404, status)
audit = sql("select count(*) from audit_events where action = 'spec.published'")
check('chaque nouvelle version est journalisée (3)', audit == '3', audit)

print('— Suppression')
status, _ = aminata.call('DELETE', f"/specs/{created['id']}")
check("une éditrice ne supprime pas (403)", status == 403, status)
status, _ = camille.call('DELETE', f"/specs/{created['id']}")
check("l'admin supprime la spec et ses versions", status == 204 and sql(f"select count(*) from api_spec_versions where spec_id = '{created['id']}'") == '0', status)
status, _ = nora.call('GET', f"/specs/{created['id']}")
check('une spec supprimée répond 404', status == 404, status)

finish()
