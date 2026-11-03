"""Sécurité des comptes: double authentification (TOTP, codes de secours, levée par un admin), sessions ouvertes, journal d'audit."""
import base64
import hashlib
import hmac
import struct
import time

from harness import Client, check, finish, login, msg, sql


def totp(secret, offset=0):
    """Code à 6 chiffres du pas courant + offset, comme une application d'authentification."""
    key = base64.b32decode(secret + '=' * (-len(secret) % 8))
    step = int(time.time() // 30) + offset
    digest = hmac.new(key, struct.pack('>Q', step), hashlib.sha1).digest()
    pos = digest[-1] & 0xF
    return str((struct.unpack('>I', digest[pos:pos + 4])[0] & 0x7FFFFFFF) % 1_000_000).zfill(6)


def wrong(code):
    return str((int(code) + 500_000) % 1_000_000).zfill(6)


def password_step(user, agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Firefox/131.0'):
    """Première étape: identifiant et mot de passe. Renvoie (client, statut, corps)."""
    from harness import DEMO
    c = Client()
    status, body = c.call('POST', '/auth/login', {'identifier': user, 'password': DEMO}, headers={'user-agent': agent})
    return c, status, body


# Les étapes de la double authentification sont espacées: pas plus de 30 s pour tout le bloc.
while time.time() % 30 > 18:
    time.sleep(1)

camille = login('camille')  # propriétaire
aminata = login('aminata')  # membre
lea = login('lea')
lea_id = sql("select id from users where username = 'lea'")

print('— Activer la double authentification')
status, state = lea.call('GET', '/me/mfa')
check('éteinte au départ, possible pour un compte à mot de passe', status == 200 and state['enabled'] is False and state['available'] is True, state)
status, setup = lea.call('POST', '/me/mfa/setup')
check('un secret, son adresse otpauth et un QR code en SVG', status == 200 and len(setup['secret']) == 32 and setup['uri'].startswith('otpauth://totp/Andal') and setup['qr'].lstrip().startswith('<svg'), {k: v[:40] for k, v in (setup or {}).items()} if status == 200 else status)
status, body = lea.call('POST', '/me/mfa/enable', {'code': wrong(totp(setup['secret']))})
check('un mauvais code n’active rien', status == 400, (status, msg(body)))
_, state = lea.call('GET', '/me/mfa')
check('toujours éteinte', state['enabled'] is False)
status, enabled = lea.call('POST', '/me/mfa/enable', {'code': totp(setup['secret'])})
codes = enabled.get('recoveryCodes', []) if status == 200 else []
check('le bon code active, avec dix codes de secours', status == 200 and len(codes) == 10, (status, enabled))
check('les codes de secours ne sont gardés qu’en empreinte', sql(f"select count(*) from recovery_codes where user_id = '{lea_id}' and code_hash like '%-%'") == '0' and sql(f"select count(*) from recovery_codes where user_id = '{lea_id}'") == '10')
_, me = lea.call('GET', '/me')
check('/me le dit', me['user']['mfa'] is True, me['user'])
status, _ = lea.call('POST', '/me/mfa/setup')
check('pas de second secret tant qu’elle est active (409)', status == 409, status)

print('— Connexion en deux étapes')
c, status, body = password_step('lea')
check('le mot de passe seul n’ouvre pas de session', status == 200 and body == {'mfa': True}, body)
status, _ = c.call('GET', '/me')
check('pas encore de session (401)', status == 401, status)
status, body = c.call('POST', '/auth/login/mfa', {'code': wrong(totp(setup['secret'], 1))})
check('mauvais code: 401', status == 401 and 'incorrect' in msg(body), (status, msg(body)))
status, body = c.call('POST', '/auth/login/mfa', {'code': totp(setup['secret'])})
check('un code déjà servi ne repasse pas', status == 401, (status, msg(body)))
status, body = c.call('POST', '/auth/login/mfa', {'code': totp(setup['secret'], 1)})
check('le code suivant ouvre la session', status == 200 and body['user']['username'] == 'lea', (status, body))
status, _ = c.call('GET', '/me')
check('la session marche', status == 200, status)
status, _ = c.call('POST', '/auth/login/mfa', {'code': codes[0]})
check("l'étape ne sert qu'une fois", status == 401, status)
check('la connexion est notée « en deux étapes » dans le journal', sql(f"select metadata->>'mfa' from audit_events where actor_id = '{lea_id}' and action = 'auth.login' order by created_at desc limit 1") == 'true')

c, _, _ = password_step('lea')
status, body = c.call('POST', '/auth/login/mfa', {'code': codes[0].upper().replace('-', ' ')})
check('un code de secours passe aussi (casse et tiret ignorés)', status == 200 and body['recoveryCodesLeft'] == 9, (status, body))
c, _, _ = password_step('lea')
status, _ = c.call('POST', '/auth/login/mfa', {'code': codes[0]})
check('un code de secours ne sert qu’une fois', status == 401, status)

c, _, _ = password_step('lea')
for _ in range(4):
    c.call('POST', '/auth/login/mfa', {'code': '000000'})
status, body = c.call('POST', '/auth/login/mfa', {'code': '000001'})
check('au cinquième code faux, l’étape tombe', status == 401 and 'Trop de codes' in msg(body), (status, msg(body)))
status, body = c.call('POST', '/auth/login/mfa', {'code': codes[1]})
check('il faut redonner le mot de passe', status == 401 and 'expirée' in msg(body), (status, msg(body)))
c, _, _ = password_step('lea')
status, _ = c.call('POST', '/auth/login/mfa', {'code': codes[1]})
check('après le mot de passe, ça repasse', status == 200, status)

print('— Désactiver, lever')
status, body = lea.call('POST', '/me/mfa/disable', {'code': '123456'})
check('désactiver demande un code valable (403)', status == 403, (status, msg(body)))
status, regen = lea.call('POST', '/me/mfa/recovery-codes', {'code': codes[2]})
check('dix nouveaux codes, contre un code de secours', status == 200 and len(regen['recoveryCodes']) == 10 and not set(regen['recoveryCodes']) & set(codes), status)
status, _ = lea.call('POST', '/me/mfa/disable', {'code': codes[3]})
check('les anciens codes ne valent plus rien', status == 403, status)
status, _ = lea.call('POST', '/me/mfa/disable', {'code': regen['recoveryCodes'][0]})
check('désactivée avec un code de secours', status == 204, status)
c, status, body = password_step('lea')
check('le mot de passe suffit de nouveau', status == 200 and 'user' in body, body)

_, setup = lea.call('POST', '/me/mfa/setup')
lea.call('POST', '/me/mfa/enable', {'code': totp(setup['secret'])})
status, _ = aminata.call('POST', f'/admin/accounts/{lea_id}/mfa/reset')
check('lever la double authentification d’un autre: admins seulement', status == 403, status)
status, _ = camille.call('POST', f'/admin/accounts/{lea_id}/mfa/reset')
check('un admin la lève (téléphone perdu)', status == 204, status)
_, overview = camille.call('GET', '/admin/accounts')
check("l'administration le montre", next(u for u in overview['users'] if u['username'] == 'lea')['mfa'] is False)
c, status, body = password_step('lea')
check('Léa se reconnecte avec son seul mot de passe', status == 200 and 'user' in body, body)

_, tok = camille.call('POST', '/me/tokens', {'name': 'x', 'scope': 'write'})
status, _ = Client().call('GET', '/me/mfa', headers={'authorization': f"Bearer {tok['token']}"})
check('jamais avec un jeton d’API (403)', status == 403, status)

print('— Sessions ouvertes')
a = login('lea')
b, _, _ = password_step('lea', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1')
status, sessions = a.call('GET', '/me/sessions')
mine = [s for s in sessions if s['current']] if status == 200 else []
check('la liste montre la session courante en tête', status == 200 and len(mine) == 1 and sessions[0]['current'], sessions)
phone = next((s for s in sessions if s['device'] == 'Safari sur iOS'), None)
check('chaque session dit son appareil, son adresse et sa date', phone and phone['ip'] and phone['createdAt'] and phone['lastSeenAt'], sessions)
check("l'identifiant montré n'est pas le cookie", all(len(s['id']) == 16 for s in sessions))
status, _ = a.call('DELETE', f"/me/sessions/{phone['id']}")
check('fermer une autre session', status == 204, status)
status, _ = b.call('GET', '/me')
check('elle ne marche plus', status == 401, status)
status, _ = a.call('DELETE', f"/me/sessions/{phone['id']}")
check('déjà fermée: 404', status == 404, status)
others = [password_step('lea')[0] for _ in range(2)]
status, body = a.call('POST', '/me/sessions/close-others')
check('« Fermer toutes les autres »', status == 200 and body['closed'] >= 2, body)
check('les autres tombent, celle-ci reste', all(o.call('GET', '/me')[0] == 401 for o in others) and a.call('GET', '/me')[0] == 200)
status, body = camille.call('POST', f'/admin/accounts/{lea_id}/sessions/close')
check('un admin ferme toutes les sessions d’un compte', status == 200 and body['closed'] >= 1, body)
check('Léa doit se reconnecter', a.call('GET', '/me')[0] == 401)
status, _ = aminata.call('POST', f'/admin/accounts/{lea_id}/sessions/close')
check('admins seulement', status == 403, status)

print('— Journal d’audit')
status, _ = aminata.call('GET', '/admin/audit')
check('réservé aux admins (403)', status == 403, status)
status, journal = camille.call('GET', '/admin/audit')
check('les événements, du plus récent au plus ancien', status == 200 and journal['events'] and journal['events'][0]['at'] >= journal['events'][-1]['at'], len(journal.get('events', [])) if status == 200 else status)
check('avec les filtres possibles', 'auth.mfa_enabled' in journal['actions'] and any(p['name'] for p in journal['people']))
_, page = camille.call('GET', '/admin/audit?action=auth.mfa_enabled')
check('filtre par action', page['events'] and all(e['action'] == 'auth.mfa_enabled' for e in page['events']), [e['action'] for e in page['events']])
_, page = camille.call('GET', '/admin/audit?action=auth.')
check('ou par famille (« auth. »)', {e['action'].split('.')[0] for e in page['events']} == {'auth'})
_, page = camille.call('GET', f'/admin/audit?actor={lea_id}&limit=5')
check('par personne, par pages de 5', len(page['events']) == 5 and all(e['actor']['id'] == lea_id for e in page['events']) and page['next'])
_, page2 = camille.call('GET', f"/admin/audit?actor={lea_id}&limit=5&before={page['next']}")
check('la page suivante continue sans doublon', page2['events'] and not {e['id'] for e in page['events']} & {e['id'] for e in page2['events']} and page2['events'][0]['at'] <= page['events'][-1]['at'])
reset = next(e for e in journal['events'] if e['action'] == 'account.mfa_reset')
check('la cible a un nom lisible', reset['target']['type'] == 'user' and reset['target']['id'] == lea_id and reset['target']['label'] == sql(f"select name from users where id = '{lea_id}'"), reset['target'])
status, body = camille.call('GET', '/admin/audit?from=2026-13-01')
check('une date invalide est refusée', status == 400, status)

projects = {p['slug']: p['id'] for p in aminata.call('GET', '/projects')[1]}
aminata.call('POST', f"/projects/{projects['paiements']}/pages", {'title': '=HYPERLINK("http://x")'})
status, headers, raw = camille.raw('GET', '/admin/audit/export?action=page.created')
text = raw.decode('utf-8-sig')
check('export CSV, en pièce jointe', status == 200 and headers['content-type'].startswith('text/csv') and 'attachment' in headers.get('content-disposition', ''), (status, headers.get('content-type')))
check('une ligne par événement, avec en-tête', text.splitlines()[0].startswith('date,action,personne') and 'page.created' in text)
check('une cible qui ressemble à une formule est neutralisée', '"\'=HYPERLINK(""http://x"")' in text, [l for l in text.splitlines() if 'HYPERLINK' in l][:1])

finish()
