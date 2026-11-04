"""Assistant de questions-réponses: réglages par les admins, récupération limitée aux pages lisibles, flux SSE, citations, quota.

Le modèle est un faux serveur compatible OpenAI (comme Ollama ou LM Studio), local: il enregistre ce qu'il reçoit.
"""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from harness import API, ORIGIN, bull, check, finish, login, msg, sql

requests = []


class FakeModel(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get('content-length', 0))))
        requests.append({'auth': self.headers.get('authorization'), 'body': body})
        self.send_response(200)
        self.send_header('content-type', 'text/event-stream')
        self.end_headers()
        for piece in ['Un jeton dure ', '15 minutes [1]', '.']:
            self.wfile.write(f"data: {json.dumps({'choices': [{'delta': {'content': piece}, 'finish_reason': None}]})}\n\n".encode())
            self.wfile.flush()
        self.wfile.write(f"data: {json.dumps({'choices': [{'delta': {}, 'finish_reason': 'stop'}]})}\n\ndata: [DONE]\n\n".encode())

    def log_message(self, *args):
        pass


server = ThreadingHTTPServer(('127.0.0.1', 0), FakeModel)
threading.Thread(target=server.serve_forever, daemon=True).start()
MODEL_URL = f'http://127.0.0.1:{server.server_address[1]}/v1'


def ask(client, question, volume=None):
    """Renvoie (statut, événements SSE)."""
    body = json.dumps({'question': question, **({'volume': volume} if volume else {})}).encode()
    status, headers, raw = client.raw('POST', '/ask', body, {'content-type': 'application/json', 'origin': ORIGIN})
    if status != 200:
        return status, json.loads(raw) if raw else None
    events = []
    for block in raw.decode().split('\n\n'):
        lines = dict(line.split(': ', 1) for line in block.splitlines() if ': ' in line)
        if 'event' in lines:
            events.append((lines['event'], json.loads(lines['data'])))
    return status, events


camille = login('camille')  # propriétaire
aminata = login('aminata')  # éditrice de Paiements, membre du groupe Paiements
nora = login('nora')  # invitée: lectrice de Paiements, hors du groupe Paiements

print('— Réglages')
status, body = aminata.call('GET', '/ask/status')
check("sans réglage, l'assistant est éteint", status == 200 and body['enabled'] is False, body)
status, _ = ask(aminata, 'Combien de temps dure un jeton ?')
check('poser une question répond 404', status == 404, status)
status, _ = aminata.call('PUT', '/admin/ai', {'provider': 'openai', 'model': 'x', 'baseUrl': MODEL_URL})
check("réservé aux admins de l'espace (403)", status == 403, status)
status, body = camille.call('PUT', '/admin/ai', {'provider': 'openai', 'model': 'llama3.1'})
check('une API compatible demande son adresse', status == 400, (status, msg(body)))
status, body = camille.call('PUT', '/admin/ai', {'provider': 'openai', 'model': 'llama3.1', 'baseUrl': MODEL_URL, 'apiKey': 'cle-locale'})
check('le modèle local est réglé, la clé jamais renvoyée', status == 200 and body['provider'] == 'openai' and body['hasApiKey'] and 'cle-locale' not in json.dumps(body), body)
status, body = camille.call('POST', '/admin/ai/test')
check('« Tester » joint le modèle', status == 200 and body['ok'] and 'jeton' in body['sample'], body)
check('la clé part dans Authorization', requests[-1]['auth'] == 'Bearer cle-locale', requests[-1]['auth'])

print('— Questions')
status, events = ask(aminata, 'Combien de temps dure un jeton d’accès OAuth ?')
kinds = [e for e, _ in events] if status == 200 else []
check('le flux: sources, texte, fin', status == 200 and kinds[0] == 'sources' and 'delta' in kinds and kinds[-1] == 'done', events)
sources = events[0][1] if status == 200 else []
answer = ''.join(d['text'] for e, d in events if e == 'delta') if status == 200 else ''
check('la réponse arrive en morceaux', answer == 'Un jeton dure 15 minutes [1].', answer)
check('les sources sont des pages lisibles, numérotées', sources and sources[0]['n'] == 1 and any(s['title'] == 'Authentification' for s in sources), sources)
sent = requests[-1]['body']['messages']
check('le modèle reçoit les extraits balisés et la question', '<extrait n="1"' in sent[1]['content'] and 'Question:' in sent[1]['content'] and sent[0]['role'] == 'system', sent[1]['content'][:200])

runbook_text = sql("select text_content from pages where title = 'Runbook incident'")[:60]
status, events = ask(aminata, 'Que faire pendant un incident du service Auth, runbook ?')
check("une membre du groupe Paiements a le runbook en source", status == 200 and any(s['title'] == 'Runbook incident' for s in events[0][1]), [s['title'] for s in events[0][1]] if status == 200 else status)
status, events = ask(nora, 'Que faire pendant un incident du service Auth, runbook ?')
titles = [s['title'] for s in events[0][1]] if status == 200 else []
leaked = runbook_text and runbook_text[:40] in requests[-1]['body']['messages'][1]['content']
check('une page sous restriction ne part jamais au modèle pour qui ne la lit pas', status == 200 and 'Runbook incident' not in titles and not leaked, titles)
status, events = ask(nora, 'Quels clusters a la plateforme ?')
check('ni les volumes fermés', status == 200 and all(s['project']['slug'] != 'plateforme' for s in events[0][1]), [s['project']['slug'] for s in events[0][1]] if status == 200 else status)
status, events = ask(aminata, 'jeton', volume='identite')
check('« volume » limite la recherche', status == 200 and all(s['project']['slug'] == 'identite' for s in events[0][1]), events[0][1] if status == 200 else status)
status, body = ask(aminata, 'x')
check('une question trop courte est refusée', status == 400, (status, body))

print('— Quota et extinction')
key = sql("select id from users where username = 'aminata'")
bull(f"const c = await q.client; await c.eval(\"for _, k in ipairs(redis.call('keys', 'andal:ask:{key}:*')) do redis.call('set', k, 40) end return 1\", 0);")
status, body = ask(aminata, 'Combien de temps dure un jeton ?')
check('au-delà de 40 questions par heure: 429', status == 429, (status, body))
status, _ = camille.call('PUT', '/admin/ai', {'provider': 'openai', 'model': 'llama3.1', 'baseUrl': MODEL_URL, 'enabled': False})
status, body = nora.call('GET', '/ask/status')
check("éteint par les admins, l'assistant disparaît", body['enabled'] is False, body)

server.shutdown()
finish()
