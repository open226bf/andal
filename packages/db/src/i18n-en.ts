/**
 * Catalogue anglais des messages du serveur: la phrase française (erreurs de
 * l'API, emails) → sa traduction. `{nom}` marque une valeur, à garder telle quelle.
 *
 * Les clés à `{nom}` servent aussi de motifs pour retraduire un message déjà
 * rédigé (translateMessage), essayés dans l'ordre du catalogue: un motif plus
 * précis passe avant un motif plus large qu'il recoupe.
 */
export const en: Record<string, string> = {
  /* ---------- Communs ---------- */
  "Réservé aux admins de l'espace.": 'Restricted to workspace admins.',
  'Réservé aux admins du volume.': 'Restricted to volume admins.',
  'Compte introuvable.': 'Account not found.',
  'Seul un propriétaire peut modifier ce compte.': 'Only an owner can modify this account.',
  'Liste invalide.': 'Invalid list.',
  'Valeur invalide.': 'Invalid value.',
  'Aucun fichier reçu.': 'No file received.',
  'Volume archivé: lecture seule.': 'Archived volume: read-only.',
  'Le serveur de collaboration ne répond pas. Réessayez dans un instant.': 'The collaboration server isn’t responding. Try again in a moment.',
  'Le compte de {name} est désactivé.': '{name}’s account is disabled.',

  /* ---------- Requêtes, origine, débit ---------- */
  'Origine refusée': 'Origin not allowed',
  'Trop de requêtes: au plus {limit} écritures par minute. Réessayez dans {seconds} s.': 'Too many requests: at most {limit} writes per minute. Try again in {seconds} s.',
  'Trop de requêtes: au plus {limit} requêtes par minute. Réessayez dans {seconds} s.': 'Too many requests: at most {limit} requests per minute. Try again in {seconds} s.',

  /* ---------- Connexion, sessions, jetons ---------- */
  'Champ « identifiant » invalide.': 'Invalid “username” field.',
  'Champ « mot de passe » invalide.': 'Invalid “password” field.',
  'Champ « mot de passe actuel » invalide.': 'Invalid “current password” field.',
  'Champ « nouveau mot de passe » invalide.': 'Invalid “new password” field.',
  'Champ « {field} » invalide.': 'Invalid “{field}” field.',
  'Langue inconnue: « fr » ou « en ».': 'Unknown language: “fr” or “en”.',
  'Identifiant ou mot de passe incorrect.': 'Incorrect username or password.',
  'Ce compte est désactivé. Contactez un admin de votre espace.': 'This account is disabled. Contact a workspace admin.',
  'Ce compte se connecte par SSO: le mot de passe se gère chez le fournisseur.': 'This account signs in with SSO: the password is managed by the provider.',
  'Mot de passe actuel incorrect.': 'Incorrect current password.',
  "Choisissez un mot de passe différent de l'actuel.": 'Choose a password different from your current one.',
  'Le mot de passe doit faire au moins {min} caractères.': 'The password must be at least {min} characters.',
  'Le mot de passe doit faire au plus {max} caractères.': 'The password must be at most {max} characters.',
  'Le mot de passe ne doit pas contenir votre email ou votre identifiant.': 'The password must not contain your email or username.',
  'Trop de tentatives. Réessayez dans {minutes} min.': 'Too many attempts. Try again in {minutes} min.',
  'Session absente': 'No session',
  'Session expirée': 'Session expired',
  'Session révoquée': 'Session revoked',
  'Jeton invalide': 'Invalid token',
  'Jeton invalide, expiré ou révoqué': 'Invalid, expired, or revoked token',
  'Compte désactivé': 'Account disabled',
  'Cette route demande une session de navigateur, pas un jeton d’API.': 'This route requires a browser session, not an API token.',
  'Ce jeton est en lecture seule.': 'This token is read-only.',
  'Session introuvable, ou déjà fermée.': 'Session not found, or already closed.',
  'Session inconnue.': 'Unknown session.',
  'Fermez vos propres sessions depuis Mon compte.': 'Close your own sessions from My account.',
  'Appareil inconnu': 'Unknown device',
  Navigateur: 'Browser',
  Présentation: 'Overview',

  /* ---------- Double authentification ---------- */
  'Code incorrect ou déjà utilisé.': 'Incorrect code, or code already used.',
  'Étape expirée: reconnectez-vous avec votre mot de passe.': 'This step has expired: sign in again with your password.',
  'Trop de codes incorrects: reconnectez-vous avec votre mot de passe.': 'Too many incorrect codes: sign in again with your password.',
  'Ce compte se connecte par SSO: la double authentification se règle chez votre fournisseur d’identité.':
    'This account signs in with SSO: two-factor authentication is managed by your identity provider.',
  'La double authentification est déjà active.': 'Two-factor authentication is already enabled.',
  'Le QR code a expiré: recommencez.': 'The QR code has expired: start over.',
  'Code incorrect: vérifiez l’heure du téléphone, puis tapez le code affiché.': 'Incorrect code: check your phone’s clock, then enter the code shown.',
  'La double authentification n’est pas active.': 'Two-factor authentication isn’t enabled.',
  'Désactivez votre propre double authentification depuis Mon compte.': 'Turn off your own two-factor authentication from My account.',
  'Ce compte n’a pas de double authentification.': 'This account doesn’t have two-factor authentication.',

  /* ---------- Comptes et invitations ---------- */
  'Vous ne pouvez pas modifier votre propre compte ici.': 'You can’t modify your own account here.',
  "L'espace doit garder au moins un propriétaire actif.": 'The workspace must keep at least one active owner.',
  'Adresse email invalide.': 'Invalid email address.',
  'Vous ne pouvez pas attribuer ce rôle.': 'You can’t assign this role.',
  'Un compte existe déjà pour cette adresse.': 'An account already exists for this address.',
  'Groupes invalides.': 'Invalid groups.',
  'Un des groupes n’existe plus.': 'One of the groups no longer exists.',
  'Invitation introuvable.': 'Invitation not found.',
  'Seul un propriétaire peut renvoyer cette invitation.': 'Only an owner can resend this invitation.',
  'La connexion par mot de passe est désactivée sur ce serveur.': 'Password sign-in is disabled on this server.',
  "Réactivez d'abord ce compte.": 'Reactivate this account first.',
  'Ce lien n’est plus valable.': 'This link is no longer valid.',
  'Indiquez votre nom.': 'Enter your name.',
  'Identifiant: 2 à 40 caractères parmi a-z, 0-9, point, tiret et souligné.': 'Username: 2 to 40 characters from a-z, 0-9, period, hyphen, and underscore.',
  'Cet identifiant ou cette adresse est déjà utilisé.': 'This username or address is already in use.',

  /* ---------- Groupes ---------- */
  'Donnez un nom au groupe.': 'Give the group a name.',
  'Un nom de groupe fait au plus {max} caractères.': 'A group name can be at most {max} characters.',
  'Ce groupe est tenu par votre fournisseur d’identité (le SSO): son nom et ses membres se gèrent là-bas.': 'This group is managed by your identity provider (SSO): its name and members are managed there.',
  'Ce groupe est tenu par votre fournisseur d’identité (SCIM): son nom et ses membres se gèrent là-bas.': 'This group is managed by your identity provider (SCIM): its name and members are managed there.',
  'Groupe introuvable.': 'Group not found.',
  'Un groupe porte déjà ce nom.': 'A group with this name already exists.',
  'Ce groupe restreint l’accès à {n} page. Retirez-le d’abord de ces restrictions: le supprimer pourrait les ouvrir à tout le volume.':
    'This group restricts access to {n} page. Remove it from that restriction first: deleting it could open the page to the whole volume.',
  'Ce groupe restreint l’accès à {n} pages. Retirez-le d’abord de ces restrictions: le supprimer pourrait les ouvrir à tout le volume.':
    'This group restricts access to {n} pages. Remove it from those restrictions first: deleting it could open those pages to the whole volume.',

  /* ---------- Accès et restrictions ---------- */
  'Seul un admin du volume peut modifier ses accès.': 'Only a volume admin can change its access.',
  'Désarchivez le volume pour modifier ses accès.': 'Unarchive the volume to change its access.',
  'Personne ou groupe invalide.': 'Invalid person or group.',
  'Ce groupe n’existe pas.': 'This group doesn’t exist.',
  'Ce compte n’existe pas.': 'This account doesn’t exist.',
  'Vous perdriez l’administration de ce volume. Demandez à un autre admin de le faire.': 'You would lose admin rights on this volume. Ask another admin to do it.',
  'Rôle inconnu.': 'Unknown role.',
  '{name} est invité de l’espace: au plus éditeur d’un volume.': '{name} is a workspace guest: at most an editor on a volume.',
  'Il faut le droit d’écriture sur la page pour la restreindre.': 'Restricting the page requires write access to it.',
  'Vous perdriez vous-même l’accès à cette page. Ajoutez-vous à la liste, ou un groupe dont vous faites partie.':
    'You would lose access to this page yourself. Add yourself to the list, or a group you belong to.',

  /* ---------- Volumes, rayons, bibliothèque ---------- */
  'Donnez un nom au volume.': 'Give the volume a name.',
  'Un nom de volume fait au plus {max} caractères.': 'A volume name can be at most {max} characters.',
  'Le nom court, écrit sur le dos du volume, fait au plus {max} caractères.': 'The short name, written on the volume’s spine, can be at most {max} characters.',
  'Une description fait au plus {max} caractères.': 'A description can be at most {max} characters.',
  'Couleur de volume inconnue.': 'Unknown volume color.',
  'Les invités ne créent pas de volume.': 'Guests can’t create volumes.',
  'Désarchivez le volume pour le modifier.': 'Unarchive the volume to modify it.',
  'Ce volume est déjà archivé.': 'This volume is already archived.',
  'Ce volume n’est pas archivé.': 'This volume isn’t archived.',
  'Seuls les admins de l’espace suppriment un volume.': 'Only workspace admins can delete a volume.',
  'Archivez d’abord le volume: on ne supprime qu’un volume archivé.': 'Archive the volume first: only archived volumes can be deleted.',
  'Tapez « {name} » pour confirmer.': 'Type “{name}” to confirm.',
  'Un volume archivé ne se pose pas sur l’étagère.': 'An archived volume can’t go on the shelf.',
  'Donnez un nom au rayon.': 'Give the section a name.',
  'Un nom de rayon fait au plus {max} caractères.': 'A section name can be at most {max} characters.',
  'Seuls les admins de l’espace rangent la bibliothèque.': 'Only workspace admins can arrange the library.',
  'Rayon introuvable.': 'Section not found.',
  'Un rayon porte déjà ce nom.': 'A section with this name already exists.',
  'Donnez tous les rayons de l’espace, chacun une fois.': 'List every section in the workspace, each one once.',
  'Rayon invalide.': 'Invalid section.',
  'Ce rayon n’existe pas.': 'This section doesn’t exist.',
  'Groupe supprimé': 'Deleted group',
  'Compte supprimé': 'Deleted account',
  '{n} personne(s)': '{n} member(s)',

  /* ---------- Pages, corbeille, versions, contenu ---------- */
  'Donnez un titre à la page.': 'Give the page a title.',
  'Un titre fait au plus {max} caractères.': 'A title can be at most {max} characters.',
  'Page parente invalide.': 'Invalid parent page.',
  'Il faut le droit d’écriture sur le volume pour ajouter une page au premier niveau.': 'Adding a top-level page requires write access to the volume.',
  'La page parente est dans un autre volume.': 'The parent page is in another volume.',
  'Il faut le droit d’écriture sur « {title} » pour y ajouter une page.': 'Adding a page under “{title}” requires write access to it.',
  'Vous ne pouvez pas modifier cette page.': 'You can’t modify this page.',
  'Un chapeau fait au plus {max} caractères.': 'A summary can be at most {max} characters.',
  'Une page ne peut pas aller sous elle-même.': 'A page can’t go under itself.',
  'Une page ne peut pas aller sous une de ses sous-pages.': 'A page can’t go under one of its subpages.',
  'Cette page hérite de la restriction en lecture de « {title} ». Hors de cette page, elle s’ouvrirait à plus de monde : levez d’abord la restriction, ou choisissez une destination sous « {title} ».':
    'This page inherits the read restriction of “{title}”. Outside that page, it would open to more people: lift the restriction first, or choose a destination under “{title}”.',
  'Cette page hérite de la restriction en écriture de « {title} ». Hors de cette page, elle s’ouvrirait à plus de monde : levez d’abord la restriction, ou choisissez une destination sous « {title} ».':
    'This page inherits the write restriction of “{title}”. Outside that page, it would open to more people: lift the restriction first, or choose a destination under “{title}”.',
  'Vous ne pouvez pas modifier toutes ses sous-pages : impossible de mettre cette branche à la corbeille.': 'You can’t modify all of its subpages: this branch can’t be moved to the trash.',
  'La corbeille est réservée aux personnes qui écrivent sur le volume.': 'The trash is only available to people with write access to the volume.',
  'Seul un admin du volume peut supprimer définitivement.': 'Only a volume admin can delete permanently.',
  'Restaurez d’abord « {title} », sa page parente.': 'Restore its parent page, “{title}”, first.',
  'Cette page vient d’un dépôt Git: modifiez-la dans le dépôt, la synchro suivante la mettra à jour.': 'This page comes from a Git repository: edit it in the repository, and the next Git sync will update it.',
  'Il faut le droit d’écriture sur la page pour restaurer une version.': 'Restoring a version requires write access to the page.',
  'C’est déjà la version actuelle.': 'This is already the current version.',
  'Cette version ne peut pas être restaurée.': 'This version can’t be restored.',
  'Le contenu de cette version est celui de la page actuelle.': 'This version’s content is the same as the current page.',
  'Envoyez `{ "content": <document> }`, `{ "markdown": "…" }`, ou du Markdown brut (Content-Type: text/markdown).':
    'Send `{ "content": <document> }`, `{ "markdown": "…" }`, or raw Markdown (Content-Type: text/markdown).',
  'Le document doit être de type « doc ».': 'The document must be of type “doc”.',
  'Le document ne respecte pas le schéma d’Andal: {problem}': 'The document doesn’t match Andal’s schema: {problem}',
  'Le document ne respecte pas le schéma d’Andal.': 'The document doesn’t match Andal’s schema.',

  /* ---------- Commentaires ---------- */
  'Le commentaire est vide.': 'The comment is empty.',
  'Un commentaire fait au plus {max} caractères.': 'A comment can be at most {max} characters.',
  'Ancre invalide.': 'Invalid anchor.',
  'Vous ne pouvez que lire cette page.': 'You can only read this page.',
  'Le passage a changé entre-temps, ou couvre plusieurs paragraphes. Sélectionnez-le de nouveau.': 'The passage has changed in the meantime, or spans several paragraphs. Select it again.',
  'Rouvrez le fil pour y répondre.': 'Reopen the thread to reply.',
  'Vous ne pouvez supprimer que vos propres commentaires.': 'You can only delete your own comments.',
  "D'autres ont répondu: résolvez le fil plutôt que de le supprimer.": 'Others have replied: resolve the thread instead of deleting it.',

  /* ---------- Fichiers, aperçus de liens ---------- */
  "L'envoi de fichiers n'est pas configuré sur ce serveur (S3_BUCKET).": 'File uploads aren’t configured on this server (S3_BUCKET).',
  'Envoyez le fichier en multipart/form-data.': 'Send the file as multipart/form-data.',
  'Fichier trop lourd: {max} Mo au plus.': 'File too large: {max} MB max.',
  'Le fichier est vide.': 'The file is empty.',
  'Le stockage des fichiers ne répond pas. Réessayez dans un instant.': 'File storage isn’t responding. Try again in a moment.',
  "Le stockage des fichiers n'est pas configuré.": 'File storage isn’t configured.',
  'Le stockage des fichiers ne répond pas.': 'File storage isn’t responding.',
  'Adresse https attendue.': 'Expected an https address.',
  'Aperçu indisponible.': 'Preview unavailable.',
  'Aperçu indisponible pour le moment.': 'Preview unavailable right now.',

  /* ---------- Specs OpenAPI ---------- */
  'version: un entier à partir de 1.': 'version: an integer starting at 1.',
  'Donnez un nom court à la spec (?name=paiements).': 'Give the spec a short name (?name=payments).',
  'Le fichier ne se lit ni en YAML ni en JSON: {error}': 'The file can’t be read as YAML or JSON: {error}',
  "Le fichier n'est pas un document YAML ou JSON.": 'The file isn’t a YAML or JSON document.',
  'Swagger 2 n’est pas pris en charge: convertissez la spec en OpenAPI 3.': 'Swagger 2 isn’t supported: convert the spec to OpenAPI 3.',
  'Le document n’a pas de champ « openapi: 3.x ».': 'The document has no “openapi: 3.x” field.',
  'Le document n’a pas de titre (info.title).': 'The document has no title (info.title).',
  'Le document n’a pas de chemins (paths).': 'The document has no paths (paths).',
  "La spec n'a pas de version {sequence}.": 'The spec has no version {sequence}.',
  "« {key} » n'existe plus dans la version {version} de {spec}.": '“{key}” no longer exists in version {version} of {spec}.',
  'Publier une spec demande le droit d’écriture sur le volume.': 'Publishing a spec requires write access to the volume.',
  'Spec trop lourde: 2 Mo au plus.': 'Spec too large: 2 MB max.',
  'Envoyez la spec en YAML ou en JSON (corps de la requête ou fichier multipart).': 'Send the spec as YAML or JSON (request body or multipart file).',

  /* ---------- Jetons d'API ---------- */
  'Donnez un nom au jeton (60 caractères au plus): « CI specs », « Script d’export »…': 'Give the token a name (60 characters max): “CI specs”, “Export script”…',
  'Portée: « read » (lecture) ou « write » (lecture et écriture).': 'Scope: “read” (read-only) or “write” (read and write).',
  'Durée: {days} jours, ou sans expiration.': 'Duration: {days} days, or no expiration.',
  '{max} jetons actifs au plus: révoquez ceux qui ne servent plus.': 'At most {max} active tokens: revoke the ones you no longer use.',

  /* ---------- Intégrations (webhooks) ---------- */
  'Donnez un nom à l’intégration (80 caractères au plus).': 'Give the integration a name (80 characters max).',
  'Type: generic, slack (Slack ou Mattermost) ou teams.': 'Type: generic, slack (Slack or Mattermost), or teams.',
  'Choisissez au moins un événement parmi {events}.': 'Choose at least one event from {events}.',
  'Volume inconnu.': 'Unknown volume.',
  'Adresse invalide.': 'Invalid address.',
  'Seules les adresses http(s) sont acceptées.': 'Only http(s) addresses are accepted.',
  'Pas d’identifiants dans l’adresse: utilisez la signature pour authentifier les envois.': 'No credentials in the address: use the signature to authenticate deliveries.',
  'Adresse trop longue.': 'Address too long.',
  'Adresse interne refusée.': 'Internal address refused.',
  'Réponse HTTP {status}': 'HTTP response {status}',

  /* ---------- Synchro Git ---------- */
  'Adresse du dépôt en https:// (par exemple https://github.com/equipe/docs.git).': 'The repository address must use https:// (for example https://github.com/team/docs.git).',
  'Pas d’identifiants dans l’adresse: utilisez le jeton d’accès.': 'No credentials in the address: use the access token.',
  'Nom de branche invalide.': 'Invalid branch name.',
  'Dossier invalide.': 'Invalid folder.',
  'Signature invalide.': 'Invalid signature.',

  /* ---------- Modèles et exports ---------- */
  'Modèle inconnu. Modèles: {list}.': 'Unknown template. Templates: {list}.',
  'Format inconnu: « markdown » ou « pdf ».': 'Unknown format: “markdown” or “pdf”.',
  "L'export PDF n'est pas configuré sur ce serveur (GOTENBERG_URL).": 'PDF export isn’t configured on this server (GOTENBERG_URL).',
  'Le moteur PDF ne répond pas. Réessayez dans un instant.': 'The PDF engine isn’t responding. Try again in a moment.',
  'Le moteur PDF n’a pas pu produire ce document.': 'The PDF engine couldn’t produce this document.',

  /* ---------- Liens publics ---------- */
  'Les liens publics sont désactivés sur ce serveur (PUBLIC_LINKS).': 'Public links are disabled on this server (PUBLIC_LINKS).',
  'Seuls les admins du volume publient un lien public.': 'Only volume admins publish a public link.',
  'Seuls les admins du volume retirent un lien public.': 'Only volume admins remove a public link.',
  'Cette page est restreinte en lecture : elle ne peut pas être publique. Levez d’abord la restriction.': 'This page has restricted read access: it can’t be public. Lift the restriction first.',
  'Indiquez la page (pageId) ou le volume (projectId) à publier.': 'Give the page (pageId) or the volume (projectId) to publish.',

  /* ---------- Imports ---------- */
  "L'import demande le stockage des fichiers (S3_BUCKET), absent sur ce serveur.": 'Importing needs file storage (S3_BUCKET), which this server doesn’t have.',
  'Envoyez l’archive en multipart/form-data.': 'Send the archive as multipart/form-data.',
  'Ce volume est archivé: rien ne s’y ajoute.': 'This volume is archived: nothing can be added to it.',
  'Archive trop lourde: {n} Mo au plus.': 'Archive too large: {n} MB at most.',
  'Formats acceptés : archive .zip (Markdown, Notion, Confluence), fichier .md ou page .html.': 'Accepted formats: .zip archive (Markdown, Notion, Confluence), .md file or .html page.',
  'Page de destination invalide.': 'Invalid destination page.',
  'La page de destination est dans un autre volume.': 'The destination page is in another volume.',
  'Il faut le droit d’écriture sur la page de destination.': 'You need write access to the destination page.',
  'Il faut le droit d’écriture sur le volume pour y importer des pages.': 'You need write access to the volume to import pages into it.',
  'L’archive contient plus de {n} fichiers.': 'The archive contains more than {n} files.',
  'L’archive déballée dépasse la taille permise.': 'The unpacked archive exceeds the allowed size.',
  'Format non reconnu: envoyez une archive .zip, un fichier .md ou une page .html.': 'Unrecognized format: send a .zip archive, a .md file or an .html page.',
  'Aucune page à importer: l’archive ne contient ni Markdown, ni page HTML.': 'Nothing to import: the archive contains neither Markdown nor HTML pages.',
  'Le stockage des fichiers n’est pas configuré.': 'File storage isn’t configured.',
  'Import interrompu (le worker s’est arrêté). Relancez-le.': 'Import interrupted (the worker stopped). Start it again.',
  'Plus de {n} fichiers Markdown: choisissez un dossier plus précis.': 'More than {n} Markdown files: choose a narrower folder.',
  'La page de destination a disparu: les pages sont au premier niveau du volume.': 'The destination page is gone: the pages are at the top level of the volume.',
  'Aucune page HTML lisible dans l’archive.': 'No readable HTML page in the archive.',
  '{path}: trop lourd, laissé de côté.': '{path}: too large, left out.',

  /* ---------- Journal d'audit ---------- */
  '{field}: une date AAAA-MM-JJ.': '{field}: a YYYY-MM-DD date.',
  '{field}: date invalide.': '{field}: invalid date.',
  'action: « auth.login » ou une famille, « auth. ».': 'action: “auth.login” or a family, “auth.”.',
  'actor: identifiant de compte invalide.': 'actor: invalid account ID.',
  'target: identifiant invalide.': 'target: invalid ID.',
  'before: curseur invalide.': 'before: invalid cursor.',

  /* ---------- Assistant ---------- */
  'Fournisseur: anthropic (Claude) ou openai (toute API compatible, locale comprise).': 'Provider: anthropic (Claude) or openai (any compatible API, including local ones).',
  'Indiquez le modèle (par exemple claude-opus-5-5, ou llama3.1 pour Ollama).': 'Enter the model (for example claude-opus-5-5, or llama3.1 for Ollama).',
  'Adresse de l’API invalide.': 'Invalid API address.',
  'Pour une API compatible OpenAI, donnez son adresse (par exemple http://ollama:11434/v1).': 'For an OpenAI-compatible API, enter its address (for example http://ollama:11434/v1).',
  'Aucun modèle configuré.': 'No model configured.',
  '{n} questions par heure au plus: réessayez dans un moment.': 'At most {n} questions per hour: try again in a little while.',
  'L’assistant n’est pas activé sur cet espace.': 'The assistant isn’t enabled in this workspace.',
  'Posez une question de 3 à 1 000 caractères.': 'Ask a question of 3 to 1,000 characters.',
  // Le motif avec détail passe avant celui sans, qu'il recoupe.
  'Le modèle a répondu {status}: {detail}': 'The model responded {status}: {detail}',
  'Le modèle a répondu {status}': 'The model responded {status}',
  'Le modèle a décliné cette question. Reformulez-la, ou cherchez directement dans les pages citées.': 'The model declined this question. Rephrase it, or search the cited pages directly.',
  'Le modèle ne répond pas pour le moment. Réessayez dans un instant.': 'The model isn’t responding right now. Try again in a moment.',

  /* ---------- Emails ---------- */
  'Bonjour {name},': 'Hello {name},',
  'Bonjour,': 'Hello,',
  // Mot de passe choisi à nouveau (lancé par un admin).
  'Choisissez un nouveau mot de passe Andal': 'Choose a new Andal password',
  '{actor} a lancé la réinitialisation de votre mot de passe Andal.': '{actor} started a reset of your Andal password.',
  'Choisir un nouveau mot de passe': 'Choose a new password',
  'Ce lien sert une seule fois et expire dans 24 heures. Votre mot de passe actuel reste valable tant que vous ne l’avez pas remplacé.':
    'This link works only once and expires in 24 hours. Your current password remains valid until you replace it.',
  // Invitation.
  '{actor} vous invite sur {workspace}': '{actor} invited you to {workspace}',
  '{actor} vous invite à rejoindre « {workspace} » sur Andal, la documentation de l’équipe.': '{actor} invited you to join “{workspace}” on Andal, your team’s documentation.',
  'Créer mon compte': 'Create my account',
  'Ce lien sert une seule fois et expire dans 7 jours. Si vous n’attendiez pas cette invitation, ignorez cet email.':
    'This link works only once and expires in 7 days. If you weren’t expecting this invitation, you can ignore this email.',
  // Mot de passe oublié.
  'Réinitialisation de votre mot de passe Andal': 'Reset your Andal password',
  'Quelqu’un, sans doute vous, a demandé à réinitialiser votre mot de passe Andal.': 'Someone, probably you, asked to reset your Andal password.',
  'Ce lien sert une seule fois et expire dans une heure. Si vous n’êtes pas à l’origine de la demande, ignorez cet email: votre mot de passe ne change pas.':
    'This link works only once and expires in one hour. If you didn’t make this request, ignore this email: your password won’t change.',
  // Double authentification levée par un admin.
  'Votre double authentification Andal a été levée': 'Two-factor authentication was removed from your Andal account',
  '{actor} a levé la double authentification de votre compte Andal. Seul votre mot de passe protège désormais votre compte.':
    '{actor} removed two-factor authentication from your Andal account. Your account is now protected by your password alone.',
  'La réactiver': 'Turn it back on',
  'Si vous n’avez rien demandé, prévenez un admin de votre espace et changez votre mot de passe.': 'If you didn’t ask for this, tell a workspace admin and change your password.',
  // Notifications non lues (worker).
  '{actor} vous a cité sur « {page} ».': '{actor} mentioned you on “{page}”.',
  '{actor} a résolu votre fil sur « {page} ».': '{actor} resolved your thread on “{page}”.',
  '{actor} a répondu dans un fil que vous suivez, sur « {page} ».': '{actor} replied in a thread you follow, on “{page}”.',
  'Quelqu’un': 'Someone',
  '{n} nouveauté vous attend sur Andal': '{n} update is waiting for you on Andal',
  '{n} nouveautés vous attendent sur Andal': '{n} updates are waiting for you on Andal',
  'Voici ce qui vous attend sur Andal :': 'Here’s what’s waiting for you on Andal:',
  '• {sentence} « {excerpt} »': '• {sentence} “{excerpt}”',
  'Ouvrir le fil': 'Open the thread',
  'Ouvrir le premier fil': 'Open the first thread',
  'Vous recevez cet email parce que ces notifications n’ont pas été lues dans Andal. Pour ne plus les recevoir par email, décochez « Aussi par email » dans vos notifications.':
    'You’re receiving this email because these notifications haven’t been read in Andal. To stop getting them by email, uncheck “Also by email” in your notifications.',
};
