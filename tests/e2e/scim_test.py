"""Annuaire: jeton SCIM de l'espace, comptes et groupes provisionnés par le fournisseur d'identité (formes Okta et Entra ID), groupes SSO synchronisés à la connexion."""
import json
import subprocess

from harness import ROOT, Client, check, finish, login, msg, sql

camille = login('camille')  # propriétaire
aminata = login('aminata')  # membre

print('— Jeton')
status, _ = aminata.call('POST', '/admin/scim/token')
check('réservé aux admins de l’espace (403)', status == 403, status)
status, state = camille.call('GET', '/admin/scim')
check('pas de jeton au départ, adresse de base donnée', status == 200 and state['token'] is None and state['baseUrl'].endswith('/api/scim/v2'), state)
status, created = camille.call('POST', '/admin/scim/token')
TOKEN = created['token'] if status == 201 else ''
check('le jeton est montré une fois (201)', status == 201 and TOKEN.startswith('andal_scim_'), status)
_, state = camille.call('GET', '/admin/scim')
check('ensuite, seul son début reste visible', state['token']['prefix'] and TOKEN not in json.dumps(state), state['token'])

idp = Client()


def scim(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {'authorization': f'Bearer {token or TOKEN}'}
    if data:
        headers['content-type'] = 'application/scim+json'
    status, headers, raw = idp.raw(method, f'/scim/v2{path}', data, headers)
    return status, headers, json.loads(raw) if raw else None


status, headers, body = scim('GET', '/ServiceProviderConfig', token='andal_scim_faux')
check('sans bon jeton: 401 au format SCIM', status == 401 and body['schemas'] == ['urn:ietf:params:scim:api:messages:2.0:Error'] and body['status'] == '401', body)
_, tok = camille.call('POST', '/me/tokens', {'name': 'perso', 'scope': 'write'})
status, _, _ = scim('GET', '/Users', token=tok['token'])
check('un jeton d’API personnel n’ouvre pas SCIM', status == 401, status)
status, _, _ = camille.raw('GET', '/scim/v2/Users')
check('une session non plus', status == 401, status)
status, headers, body = scim('GET', '/ServiceProviderConfig')
check('découverte: PATCH oui, bulk non', status == 200 and headers['content-type'].startswith('application/scim+json') and body['patch']['supported'] and not body['bulk']['supported'], body)
status, _, body = scim('GET', '/ResourceTypes')
check('types User et Group', status == 200 and {r['id'] for r in body['Resources']} == {'User', 'Group'}, body)

print('— Comptes')
yasmine = {
    'schemas': ['urn:ietf:params:scim:schemas:core:2.0:User'],
    'userName': 'yasmine.ouedraogo@exemple.org',
    'externalId': 'okta-00u1',
    'name': {'givenName': 'Yasmine', 'familyName': 'Ouédraogo'},
    'emails': [{'value': 'yasmine.ouedraogo@exemple.org', 'primary': True, 'type': 'work'}],
    'active': True,
}
status, _, user = scim('POST', '/Users', yasmine)
YID = user['id'] if status == 201 else ''
check('création: 201, active, nom composé', status == 201 and user['active'] and user['displayName'] == 'Yasmine Ouédraogo' and user['externalId'] == 'okta-00u1', (status, user))
row = sql(f"select workspace_role, password_hash is null, username from users where id = '{YID}'")
check('membre de l’espace, sans mot de passe (elle entrera par le SSO)', row.startswith('member|t|'), row)
status, _, body = scim('POST', '/Users', yasmine)
check('en double: 409 uniqueness', status == 409 and body['scimType'] == 'uniqueness', body)
status, _, body = scim('POST', '/Users', {'userName': 'sans-email'})
check('sans email: 400', status == 400, body)
status, _, found = scim('GET', '/Users?filter=' + 'userName eq "Yasmine.Ouedraogo@exemple.org"'.replace(' ', '%20').replace('"', '%22'))
check('retrouvée par userName (sans souci de casse)', status == 200 and found['totalResults'] == 1 and found['Resources'][0]['id'] == YID, found)
status, _, found = scim('GET', '/Users?filter=externalId%20eq%20%22okta-00u1%22')
check('et par externalId', found['totalResults'] == 1, found)
status, _, body = scim('GET', '/Users?filter=title%20co%20%22x%22')
check('un filtre non pris en charge: 400 invalidFilter', status == 400 and body['scimType'] == 'invalidFilter', body)
status, _, page = scim('GET', '/Users?startIndex=2&count=2')
check('pagination startIndex / count', status == 200 and page['startIndex'] == 2 and page['itemsPerPage'] == 2 and page['totalResults'] >= 6, page.get('totalResults'))
status, _, user = scim('PATCH', f'/Users/{YID}', {'schemas': ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], 'Operations': [{'op': 'Replace', 'path': 'name.familyName', 'value': 'Ouédraogo-Kaboré'}]})
check('PATCH façon Entra ID (chemin)', status == 200 and user['displayName'] == 'Yasmine Ouédraogo-Kaboré', (status, user))

print('— Groupes')
status, _, group = scim('POST', '/Groups', {'displayName': 'Équipe Paiements', 'externalId': 'grp-pay', 'members': [{'value': YID}]})
GID = group['id'] if status == 201 else ''
check('un groupe SCIM qui porte le nom d’un groupe local reçoit « (SCIM) »', status == 201 and group['displayName'] == 'Équipe Paiements (SCIM)' and len(group['members']) == 1, (status, group))
_, overview = camille.call('GET', '/admin/groups')
mine = next((g for g in overview['groups'] if g['id'] == GID), None)
check('dans l’administration, marqué SCIM', mine and mine['source'] == 'scim' and mine['members'][0]['id'] == YID, mine)
status, body = camille.call('PATCH', f'/admin/groups/{GID}', {'name': 'Autre'})
check('ni renommé ici', status == 403 and 'fournisseur' in msg(body), (status, msg(body)))
aminata_id = sql("select id from users where username = 'aminata'")
status, _ = camille.call('PUT', f'/admin/groups/{GID}/members/{aminata_id}')
check('ni ses membres changés ici', status == 403, status)
status, _ = camille.call('DELETE', f'/admin/groups/{GID}')
check('ni supprimé ici', status == 403, status)
_, accounts = camille.call('GET', '/admin/accounts')
check('les invitations ne proposent pas les groupes SCIM', all(g['id'] != GID for g in accounts['groups']))

status, _, group = scim('PATCH', f'/Groups/{GID}', {'Operations': [{'op': 'add', 'path': 'members', 'value': [{'value': aminata_id}]}, {'op': 'remove', 'path': f'members[value eq "{YID}"]'}]})
check('PATCH: un membre entre, l’autre sort (filtre Entra ID)', status == 200 and [m['value'] for m in group['members']] == [aminata_id], (status, group))
check('les droits suivent: Aminata est dans le groupe', sql(f"select count(*) from group_members where group_id = '{GID}' and user_id = '{aminata_id}'") == '1')
status, _, group = scim('PATCH', f'/Groups/{GID}', {'Operations': [{'op': 'replace', 'value': {'id': GID, 'displayName': 'Support N2'}}]})
check('PATCH façon Okta (sans chemin): renommé', status == 200 and group['displayName'] == 'Support N2', (status, group))
status, _, listed = scim('GET', '/Groups?filter=displayName%20eq%20%22support%20n2%22&excludedAttributes=members')
check('retrouvé par displayName, sans ses membres si demandé', listed['totalResults'] == 1 and 'members' not in listed['Resources'][0], listed)
status, _, listed = scim('GET', '/Groups')
check('SCIM ne voit que ses groupes, pas les groupes locaux', all(g['id'] == GID for g in listed['Resources']), [g['displayName'] for g in listed['Resources']])
status, _, body = scim('PATCH', f'/Groups/{GID}', {'Operations': [{'op': 'add', 'path': 'members', 'value': [{'value': '00000000-0000-0000-0000-000000000000'}]}]})
check('un membre inconnu est refusé', status == 400, body)

print('— Désactivation et retrait')
status, _, user = scim('PATCH', f'/Users/{YID}', {'Operations': [{'op': 'replace', 'value': {'active': False}}]})
check('PATCH Okta « active: false » désactive le compte', status == 200 and user['active'] is False and sql(f"select disabled_at is not null from users where id = '{YID}'") == 't', user)
camille_id = sql("select id from users where username = 'camille'")
status, _, body = scim('PATCH', f'/Users/{camille_id}', {'Operations': [{'op': 'Replace', 'path': 'active', 'value': 'False'}]})
check('le dernier propriétaire actif ne se désactive pas (409)', status == 409 and sql(f"select disabled_at is null from users where id = '{camille_id}'") == 't', (status, body))
scim('PUT', f'/Groups/{GID}', {'displayName': 'Support N2', 'members': [{'value': YID}, {'value': aminata_id}]})
status, _, _ = scim('DELETE', f'/Users/{YID}')
check('DELETE: 204', status == 204, status)
status, _, _ = scim('GET', f'/Users/{YID}')
check('ensuite, 404 pour SCIM', status == 404, status)
check('le compte reste dans Andal, désactivé, hors de ses groupes SCIM', sql(f"select (disabled_at is not null)::text || (deprovisioned_at is not null)::text from users where id = '{YID}'") == 'truetrue' and sql(f"select count(*) from group_members where user_id = '{YID}'") == '0')
status, _, again = scim('POST', '/Users', yasmine)
check('revenue, elle retrouve le même compte', status == 201 and again['id'] == YID and again['active'], (status, again))
status, _, _ = scim('DELETE', f'/Groups/{GID}')
check('DELETE d’un groupe', status == 204 and scim('GET', f'/Groups/{GID}')[0] == 404)

print('— Journal et jeton')
check('le journal trace SCIM, sans auteur humain', int(sql("select count(*) from audit_events where action like 'scim.%' and actor_id is null and metadata->>'via' = 'scim'")) >= 8)
old = TOKEN
_, rotated = camille.call('POST', '/admin/scim/token')
TOKEN = rotated['token']
check('remplacer le jeton coupe l’ancien', scim('GET', '/Users', token=old)[0] == 401 and scim('GET', '/Users')[0] == 200)
status, _ = camille.call('DELETE', '/admin/scim/token')
check('le révoquer coupe tout', status == 204 and scim('GET', '/Users')[0] == 401)

print('— Groupes SSO à la connexion')
thomas = sql("select id || '|' || workspace_id from users where username = 'thomas'").split('|')
local_before = sql(f"select string_agg(g.name, ',' order by g.name) from group_members m join groups g on g.id = m.group_id where m.user_id = '{thomas[0]}' and g.source = 'local'")
script = f"""
import {{ createDb, syncSsoGroups, ssoGroupNames }} from '@andal/db';
const db = createDb(process.env.DATABASE_URL);
const user = {{ id: '{thomas[0]}', workspace_id: '{thomas[1]}' }};
const first = await syncSsoGroups(db, user, ssoGroupNames(['/Sécurité', 'Astreinte', 'astreinte']));
const second = await syncSsoGroups(db, user, ssoGroupNames(['Astreinte']));
const again = await syncSsoGroups(db, user, ssoGroupNames(['Astreinte']));
console.log(JSON.stringify({{ first, second, again }}));
await db.destroy();
"""
out = subprocess.run(['pnpm', '--silent', '--filter', '@andal/api', 'exec', 'node', f'--env-file={ROOT}/.env', '--input-type=module', '-e', script], cwd=ROOT, capture_output=True, text=True)
result = json.loads(out.stdout.strip().splitlines()[-1]) if out.returncode == 0 else {}
check('le claim crée les groupes manquants, sans doublon de casse', len(result.get('first', {}).get('created', [])) == 2 and len(result['first']['added']) == 2, out.stderr[-300:] or result)
names = sql("select name from groups where source = 'sso' order by name").splitlines()
check('« /Sécurité » devient « Sécurité (SSO) »: un groupe local porte déjà ce nom', names == ['Astreinte', 'Sécurité (SSO)'], names)
check('un groupe absent du claim suivant: la personne en sort', len(result.get('second', {}).get('removed', [])) == 1 and not result['second']['added'], result.get('second'))
check('rien ne bouge quand le claim ne change pas', result.get('again') == {'added': [], 'removed': [], 'created': []}, result.get('again'))
local_after = sql(f"select string_agg(g.name, ',' order by g.name) from group_members m join groups g on g.id = m.group_id where m.user_id = '{thomas[0]}' and g.source = 'local'")
check('ses groupes locaux ne bougent pas', local_after == local_before and local_before, (local_before, local_after))

finish()
