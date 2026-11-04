"""Outils communs aux tests de bout en bout: client HTTP avec cookies, SQL, file BullMQ, verdicts.

Les tests tournent contre la stack de dev (`pnpm infra:up`, `pnpm dev`) avec les
données de démo (`pnpm db:seed`). Lancement: `tests/e2e/run.sh`.
"""
import http.cookiejar
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
import uuid

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
API = os.environ.get('ANDAL_API', 'http://127.0.0.1:3001/api')
MAILPIT = os.environ.get('ANDAL_MAILPIT', 'http://127.0.0.1:58025/api/v1')
ORIGIN = os.environ.get('WEB_ORIGIN', 'http://localhost:5173')


def _env():
    path = os.path.join(ROOT, '.env')
    values = {}
    if os.path.exists(path):
        for line in open(path).read().splitlines():
            if '=' in line and not line.startswith('#'):
                key, value = line.split('=', 1)
                values[key.strip()] = value.strip().strip('"')
    values.update({k: v for k, v in os.environ.items() if k in ('DEMO_PASSWORD', 'POSTGRES_USER', 'POSTGRES_DB')})
    return values


ENV = _env()
DEMO = ENV.get('DEMO_PASSWORD', '')


class Client:
    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def raw(self, method, path, data=None, headers=None):
        """Renvoie (statut, en-têtes en minuscules, corps brut)."""
        req = urllib.request.Request(API + path, data=data, method=method, headers=headers or {})
        try:
            with self.opener.open(req) as res:
                return res.status, {k.lower(): v for k, v in res.headers.items()}, res.read()
        except urllib.error.HTTPError as err:
            return err.code, {k.lower(): v for k, v in err.headers.items()}, err.read()

    def call(self, method, path, body=None, headers=None):
        data = json.dumps(body).encode() if body is not None else None
        h = {'content-type': 'application/json'} if data else {}
        h.update(headers or {})
        status, _, raw = self.raw(method, path, data, h)
        try:
            return status, json.loads(raw) if raw else None
        except ValueError:
            return status, raw.decode(errors='replace')

    def upload(self, path, name, content, content_type='application/octet-stream', fields=None):
        boundary = f'----andal{uuid.uuid4().hex}'
        # Les champs avant le fichier: le serveur les lit au fil du flux.
        head = ''.join(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n' for k, v in (fields or {}).items())
        body = (
            f'{head}--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: {content_type}\r\n\r\n'.encode()
            + content
            + f'\r\n--{boundary}--\r\n'.encode()
        )
        status, _, raw = self.raw('POST', path, body, {'content-type': f'multipart/form-data; boundary={boundary}'})
        try:
            return status, json.loads(raw) if raw else None
        except ValueError:
            return status, raw.decode(errors='replace')


def login(user, password=None):
    c = Client()
    status, body = c.call('POST', '/auth/login', {'identifier': user, 'password': password or DEMO})
    assert status == 200, f'connexion de {user}: {status} {body}'
    return c


def sql(query):
    """Requête dans la base de dev, via le conteneur Postgres du docker compose."""
    user = ENV.get('POSTGRES_USER', 'calepin')
    db = ENV.get('POSTGRES_DB', 'calepin')
    out = subprocess.run(['docker', 'compose', 'exec', '-T', 'postgres', 'psql', '-U', user, '-d', db, '-Atc', query], cwd=ROOT, capture_output=True, text=True, check=True)
    return out.stdout.strip()


def bull(code):
    """Exécute du code avec la file BullMQ `q` (ajouter une tâche, lire les planifications)."""
    valkey = os.environ.get('VALKEY_PORT', '56379')
    script = f"import {{ Queue }} from 'bullmq'; const q = new Queue('andal', {{ connection: {{ host: '127.0.0.1', port: {valkey} }} }}); {code} await q.close();"
    return subprocess.run(['pnpm', '--filter', '@andal/worker', 'exec', 'node', '--input-type=module', '-e', script], cwd=ROOT, check=True, capture_output=True, text=True).stdout


failures = 0


def check(label, ok, detail=''):
    global failures
    print(('OK   ' if ok else 'ÉCHEC') + f' {label}' + (f' — {detail}' if detail else ''))
    failures += 0 if ok else 1


def msg(body):
    return body.get('message') if isinstance(body, dict) else body


def finish():
    print(f'\n{"Tout passe" if failures == 0 else f"{failures} échec(s)"}')
    sys.exit(1 if failures else 0)
