# Andal

[Français](README.fr.md) · **English**

Open-source documentation tool for tech teams: per-project volumes, numbered pages, collaborative editing, Mermaid, OpenAPI and draw.io blocks, and read / comment / write permissions per project and per page.

**Version 0.1**, the first release: what it contains is in [CHANGELOG.md](CHANGELOG.md), and what it doesn't do yet is under [What's left to do](#whats-left-to-do). The visual direction is described in [DESIGN.md](DESIGN.md), the product in [PRODUCT.md](PRODUCT.md), and the reference mockup is in [maquette/index.html](maquette/index.html).

**The name.** *Andal* comes from the Fulfulde word *anndal*: knowledge, science. The prototype was called Calepin; the development infrastructure identifiers (Postgres database and user, Keycloak realm and client, RustFS keys, demo password) keep that name so that existing Docker volumes don't break.

## Getting started

Requirements: Node 22.12 or later, pnpm 11 (`corepack enable`), Docker.

```bash
cp .env.example .env
```

```bash
pnpm infra:up
```

```bash
pnpm install
```

```bash
pnpm db:migrate && pnpm db:seed
```

```bash
pnpm dev
```

Then open http://localhost:5173 and sign in with a demo account: the username is in the table below, and the password is `DEMO_PASSWORD` in `.env`. `pnpm db:seed` resets the demo database at any time (it refuses to run with `NODE_ENV=production`).

On a fresh install without demo data, create the first account (it becomes the workspace owner):

```bash
pnpm db:migrate && pnpm user:add
```

## Ports

Everything listens on 127.0.0.1 only.

| Service | Port | Role |
|---|---|---|
| web (Vite) | 5173 | UI; proxies `/api` to the API and `/collab` to the collab server |
| api (NestJS) | 3001 | REST, sessions, permissions, search |
| collab (Hocuspocus) | 3002 | Real-time editing (Yjs), permission checks on connection |
| worker (BullMQ) | – | Full-text indexing after each save, notification emails |
| PostgreSQL 18 | 55432 | Data, `ltree` tree, `tsvector` search, audit log |
| Valkey 8 | 56379 | Sessions, job queue, rate limiting, sync and write queue for the collab instances |
| RustFS | 59000 / 59001 | S3 storage for attached files |
| draw.io | 58081 | Embedded diagram editor |
| Mailpit | 51025 / 58025 | Fake SMTP server for development; sent emails can be read at http://localhost:58025 |
| Gotenberg | 53000 | PDF export (Chromium) |
| Keycloak | 58080 | OIDC SSO, only with `docker compose --profile sso up -d` |

## Demo accounts

| Username | Account | What it shows |
|---|---|---|
| `aminata` | Aminata K. | Can write on Paiements (Payments); comment only on 3.3 Webhooks (write-restricted to Thomas). A mention from Thomas is waiting in her notifications |
| `thomas` | Thomas R. | Can write on Paiements, including 3.3 Webhooks; can write on Identité (Identity) |
| `lea` | Léa M. | Can comment on Paiements; cannot see 4.1 Runbook incident (Incident runbook), which is restricted to the Équipe Paiements (Payments team) group |
| `nora` | Nora B. (contractor) | Guest, read-only on Paiements, no other volume |
| `camille` | Camille D. | Workspace owner: manages accounts (account menu → Manage accounts), admin of every volume |

The email address (`aminata@andal.test`, …) also works as a username.

The demo has 12 volumes arranged in 4 aisles; Données et analytics (Data and analytics) is not in any aisle. Each account has pinned the first five to its shelf; the others wait in the library.

## Sign-in

**Password, by default.** Local accounts; sign in with either username or email, case-insensitive.

- Passwords are hashed with Argon2id (19 MiB, 2 passes), 12 characters minimum, no composition rules, and rejected if they contain the email or username.
- After 8 failures on one account (or 40 from one IP address) within 15 minutes, attempts are blocked until the window ends. The message and response time are the same whether or not the account exists.
- Server-side sessions: an `HttpOnly`, `SameSite=Lax` cookie (plus `Secure` in production) carrying a random identifier; Valkey stores only its hash. A new session is created at each sign-in.
- Changing your password (account menu) closes all your other sessions, in the API and in the collab server.
- State-changing requests from any origin other than `WEB_ORIGIN` are rejected.
- A deactivated account can no longer sign in, and its open sessions (API and collab) are cut off immediately.
- **Two-factor authentication**, opt-in for each user (see [Account security](#account-security)): after the password, a code from the authenticator app.
- From the command line, to bootstrap an install or troubleshoot: `pnpm user:add` creates an account, and `pnpm user:password <username>` changes its password.

**OpenID Connect SSO, optional.** Disabled while `OIDC_ISSUER` is empty. To try it with the local Keycloak:

```bash
docker compose --profile sso up -d keycloak
```

Then uncomment the `OIDC_*` block in `.env` and restart `pnpm dev`. A “Sign in with Keycloak” button appears below the form. The dev realm contains `thomas` (linked to Thomas's Andal account through his verified email) and `inconnu` (no Andal account, so it is rejected), with the same password as the demo.

With another provider (Authentik, Entra ID, Google, …), set its issuer, the client ID and the client secret, and register `WEB_ORIGIN/api/auth/callback` as the redirect URI with the provider.

- Authorization code flow with PKCE (S256), `state` and `nonce`; the flow state lives in Valkey. Plain HTTP is accepted only outside production.
- An identity is tied to an account by its issuer + subject pair. On first sign-in, it is linked to the account with the same email, if the provider has verified that email. Otherwise it is rejected, unless `OIDC_AUTO_CREATE=true`: a member account is then created, with no volumes until an admin opens some to it.
- Signing out also ends the session at the provider.
- `AUTH_PASSWORD=false` leaves SSO as the only option. The API refuses to start if no sign-in method is enabled.

## Account management

Administration (`/admin`, from the account menu: **Accounts**, **Groups**, **Directory**, **Audit log**, **Integrations** and **Assistant** tabs) is restricted to the workspace owner and admins.

- **Invite**: email, optional name, workspace role and, optionally, groups. The person receives a link (valid for 7 days) where they choose their name, username and password, and then land signed in, with their groups' volumes already open to them. Without a group, they have no volumes until someone opens some to them. Pending invitations can be resent (new link; the old one stops working) or revoked.
- **Change the role**, **deactivate** or **reactivate** an account.
- **Reset the password**: a link valid for 24 hours is sent by email. The password changes only when the person picks a new one; all their sessions are then closed.
- **Forgot password**, from the sign-in screen: a link valid for 1 hour, sent only if the account exists, with the same response in every case.

Rules, enforced in the API and not just in the UI:

- Nobody can manage their own account from this screen (no self-deactivation, no self-promotion).
- An admin cannot change owner accounts and cannot make anyone an owner.
- The workspace always keeps at least one active owner.
- Invitation and reset links are random (256 bits) and single-use; only their hash is stored in the database. An expired, used or replaced link shows “This link is no longer valid”.

**Sending email.** With `SMTP_URL` set (Mailpit in development, see Ports), Andal sends invitations and reset links by email. Without SMTP, the screen shows the invitation or reset link for you to copy and pass on yourself, and “Forgot password” disappears from the sign-in screen. When a reset email has been sent, the admin never sees the link.

## Account security

**My account** (account menu) brings together the password, two-factor authentication, open sessions and API tokens.

**Two-factor authentication (TOTP).** For password accounts; an SSO account sets it up with its identity provider.

- **Turn on**: scan the QR code with an authenticator app (1Password, Bitwarden, Google Authenticator, Aegis, …) or enter the key by hand, then type a first code. Nothing changes until that code is confirmed.
- **Ten recovery codes** are then shown, only once, to copy or download. Each one can be used once in place of a code; Andal stores only their hashes. When only three are left, sign-in leads to My account to generate new ones.
- **Signing in**: the password no longer opens a session; it opens a 5-minute step where you type the code (or a recovery code). Codes have 6 digits with a 30-second time step, and one step of drift is tolerated; a code that has already been used is rejected. After 5 wrong codes, you must enter the password again; beyond 8 failures in 15 minutes on the account, everything is blocked until the window ends.
- **Turning it off** or **regenerating the recovery codes** requires a valid code.
- **Lost phone, no more codes**: a workspace admin removes two-factor authentication from Administration (Accounts → ⋯). The person is notified by email, and the action is recorded in the audit log.

**Open sessions.** The list of signed-in browsers: device (“Firefox on macOS”), IP address, start date, last activity, sign-in method (password, password and code, SSO). Each one can be closed with a click, or all the others at once; its open pages close immediately (collab server included). An admin can close all of an account's sessions (lost device, someone leaving) without deactivating it. The identifier shown is only the beginning of a hash, never the cookie.

## Directory: SSO and SCIM

The **Directory** tab in Administration connects Andal to the company's identity provider (Okta, Entra ID, Keycloak, authentik, …).

**SSO groups.** With `OIDC_GROUPS_CLAIM` (often `groups`), on each SSO sign-in the person joins the groups named in their ID token and leaves the other SSO groups. A group named for the first time is created and labeled “SSO”; you open volumes to it from the Share panel, as with any group. The claim is read from the ID token, otherwise from userinfo; `OIDC_GROUPS_SCOPE` requests an extra scope (Okta: `groups`). If the claim is missing, nothing changes. A local group that already has that name stays intact; the SSO group becomes “Name (SSO)”.

**SCIM 2.0 provisioning.** An admin creates the workspace's SCIM token (shown once, replaceable, revocable) and pastes it into the provider, along with the URL `WEB_ORIGIN/api/scim/v2`.

- **Accounts**: creation (workspace member, no password, no volumes: they sign in through SSO), name and email updates, deactivation (`active: false`, sessions closed immediately), removal (`DELETE`: the account is deactivated and leaves the SCIM directory; its history stays). An account that is removed and later pushed again gets the same account back. The last active owner cannot be deactivated.
- **Groups**: creation, renaming, members (add, remove, replace), deletion. They are labeled “SCIM”: their name and members are managed only from the directory. A group that restricts a page cannot be deleted (same rule as in Administration).
- Filters on `userName`, `externalId`, `emails.value`, `displayName` (`eq`), pagination, `excludedAttributes=members`, PATCH in both forms (with a path, Entra ID style; without a path, Okta style). No bulk operations.
- The SCIM token only opens `/api/scim/v2`: neither sessions nor personal API tokens get in there, and the SCIM token gets in nowhere else. Every action is recorded in the audit log, with no human author.

## Audit log

The **Audit log** tab in Administration shows, newest first, every sign-in (and failed attempt), every change to passwords, two-factor authentication and sessions, and every invitation, role, group, access and restriction, page, volume, spec, token, webhook, Git sync, assistant setting and SCIM action: who, what, on what (with a link to the page or volume if it still exists), and from which address.

- Filter by action or action family, by person and by date; 50 entries per page.
- **Export to CSV** (same filters, at most 50,000 rows), readable by a spreadsheet or a SIEM. Cells that would look like a formula (`=`, `+`, `-`, `@`) are neutralized.
- The log is append-only: a PostgreSQL trigger rejects any update or deletion, including by admins.

## Comments

- A commenter (or anyone with more rights) selects a passage in the text: a **Comment** button appears in the margin, and the thread is written alongside the passage. ⌘ Enter sends, Esc cancels.
- The passage is marked by the **collab server**, not by the browser: a commenter is not allowed to write to the document, and this mark does not count as an edit (neither the page's version nor its authors change).
- Reply, resolve (the thread leaves the margin and moves to “Resolved threads”), reopen. Threads whose passage was deleted from the text remain available under “Without a passage”.
- Delete: each person can delete their own messages; deleting the first message deletes the thread and removes the mark from the text. Once others have replied, only a volume admin can delete the thread.
- Other readers of the page see new threads and replies arrive without reloading.
- A reader sees threads but can neither create them nor reply.

- **Mention someone**: `@` followed by a few letters suggests the people who can read the page. The mentioned person is notified. Mentioning someone who cannot read the page sends them nothing, and the author is warned.

## Volumes

### The library and the shelf

The home page (`/`) is the **library**: every volume open to you, arranged by **aisle**, with its description, your permission level, its page count and its latest activity. You can filter them by typing (`/` puts the cursor in the field, Enter opens the first result), sort them by number, name or recent activity, and collapse an aisle. On large screens, the aisle index stays next to the list.

- **The shelf**, on the left, holds only the volumes that **you** pin (the pin on a volume card, or the one in the contents header). A volume you open without pinning it is added for the duration of the visit, after a dotted line. The books icon at the top takes you back to the library; the shelf scrolls when it is full.
- **Switch volumes** without going back to the library: the volume name at the top of the contents opens a picker you can filter from the keyboard (shelf first, then aisle by aisle). Search (⌘K) also finds volumes by name.
- **Aisles** have only one level, so they can be scanned at a glance even with many volumes. Workspace admins create, rename, reorder and delete them (“Organize aisles”); deleting an aisle leaves its volumes outside any aisle, with nothing lost. A volume's admin picks its aisle at creation or in its settings.

### Create, configure, archive

The “+” below the spines on the shelf, or “New volume” in the library, creates a volume (workspace members and admins, not guests): name, short name printed on the spine, description, and one of six cloth bindings, with a preview of the spine as it will sit on the shelf. Whoever creates it becomes its admin and finds it pinned to their shelf; it opens on a first page, “Overview” (“Présentation” for a French-speaking creator), in Edit mode. By default it gets the cloth least used on the shelf.

The gear next to the volume name, in the contents, opens its settings (volume admins):

- **Edit** the name, short name, description, cloth and aisle. The volume's URL (`/v/…`) does not change, so no links break.
- **Archive**: the volume leaves the shelf and search results and becomes read-only for everyone, admins included, already-open pages included. Its links still work, with an “Archived volume” banner. No page, comment, access or setting can change until it is unarchived.
- **Unarchive**, from the settings or from “Archived volumes” in the account menu, which lists the archived volumes you administer.
- **Delete**: workspace admins only, only for an archived volume, by retyping its short name. Pages, comments, history and permissions go with it; the audit log keeps the record.

## Pages

Anyone who can write on a page can **drag** it in the contents: onto the top or bottom of another page to place it before or after, onto the middle to nest it inside, or onto “Drop here: end of volume”. A line or a frame shows where it will land. The same “⋯” button, shown on hover, does all of this from the keyboard and on touch screens: add a subpage, rename, move up, move down, move under another page, move to trash. The “+” next to the volume name adds a top-level page; the trash is at the bottom of the contents.

- **Creating** a page requires write permission on the parent page (on the volume, at the top level). The new page inherits its parent's restrictions and opens in Edit mode; you edit its title right there.
- **Moving** a page takes its subpages, their comments and their restrictions along. A move that would take a page out from under an inherited restriction is rejected: the page would open up to more people without anyone deciding so. Lift the restriction first, or stay under the page that carries it.
- **The trash** takes the page and its subpages as one block; you must be able to edit each of them. They disappear from the contents, search and notifications, and open pages close. Restoring puts them back at the end of their section, with their comments; a page whose parent is also in the trash waits for its parent.
- **Permanent deletion**: after `TRASH_RETENTION_DAYS` days (30 by default), the worker empties the trash (it runs every 6 hours); each page shows its date. A volume admin can also delete right away from the trash. Subpages, comments and history go with the page.
- Section numbers update immediately for everyone: the collab server notifies open browsers.

### Writing: files, tables, tasks, links

In Edit mode, the toolbar inserts, in addition to text and technical blocks:

- **Images and files**: the Image or File button, or just paste a screenshot, or drop files onto the page. An image becomes a numbered figure, with a caption and alt text; any other file becomes a download card. Files go to S3 storage (RustFS in development), 25 MB at most (`UPLOAD_MAX_MB`). Whoever can read the page can read its files, and nobody else: the API checks read access on every download. An image's type is read from the file itself, not from what the browser claims; every file is served under `CSP: sandbox`, and anything that is not an image is downloaded without ever being displayed. Files from a purged page leave storage within the hour.
- **Tables**: header row, resizable columns, Tab to move between cells; the table tools appear in the toolbar when the cursor is in a table. On mobile, a wide table scrolls within its frame.
- **Task lists**: checkboxes, read-only for anyone who cannot edit the page.
- **Links** (⌘K or Ctrl K in the text): search for a page by title or number across all the volumes you can read, or paste a web address. A link to a page goes through its stable URL `/p/<id>`, which finds the page even after it moves. On hover, a preview shows the volume, number, title and the beginning of the page; a page you cannot read stays “not found”. In Edit mode, ⌘ or Ctrl + click follows the link.
- **Backlinks**: at the bottom of each page, “Cited in” lists the pages that link to it, showing only those you can read.

### History

The **History** link in the colophon lists the page's versions with their authors, and shows each one as it was, diagrams included.

- A version groups one work session: as long as the page keeps changing without 10 minutes of inactivity, the same version grows and adds its authors. Writing together produces one version with several names, not one per save.
- A version is recorded only if the content actually changes: opening a page with write permission, or reconnecting to it, creates neither a version nor an “edited by” entry.
- **Restoring** a version (write permission) replaces the content for everyone, open pages included, and creates a new version: nothing is lost, and the replaced version stays in the history. The title is restored too if it had changed.

## Access management

The **Share** button in the header shows two things and, depending on your permissions, lets you change them.

- **Volume access** (volume admins): add a person or a group, change their role (read, comment, write, volume admin), remove them.
- **Page restrictions** (write permission on the page): limit reading or writing to a list of people and groups, edit that list, lift the restriction. A restriction applies to subpages; restrictions inherited from a parent page are shown with a link to that page.

Rules, enforced in the API:

- Nobody can remove their own access by accident: you cannot step down as a volume's admin, and you cannot restrict a page without being on the list (yourself or through a group).
- A workspace guest never goes beyond write on a volume, even through a group: administering a volume means being able to open it to others.
- A group used to restrict a page cannot be deleted: the list could become empty and open the page to the whole volume.
- Every change is audited and takes effect immediately, including on pages that are already open: the collab server rechecks each connection (switching it to read-only, or closing it), and browsers reload the page, the contents and the sharing settings.

The **Groups** tab in Administration creates, renames and deletes groups, adds and removes their members, and shows the volumes each group opens.

## Notifications

The bell on the shelf lets you know when someone mentions you, replies in a thread you wrote in, or resolves a thread you started. A notification takes you to the thread on its page and is marked as read.

- Live on open pages (through the collab server), otherwise within a minute.
- A notification shows an excerpt of the comment: it disappears for anyone who loses access to the page, and comes back when access is restored.
- **By email**, only what is still unread: after `NOTIFY_EMAIL_DELAY` seconds (300 by default, 30 in `.env.example`), the worker sends a single message that bundles everything waiting. Each person can turn it off from the bell (“Also by email”).

The most complete page is **Paiements → 3.2 Authentification** (Authentication): margin notes, a Mermaid sequence diagram, a code listing, a callout, an OpenAPI endpoint and a draw.io diagram.

## OpenAPI specs

A volume stores its OpenAPI specs (3.x, YAML or JSON), listed in the contents under “API specs”. Each one opens in Redoc, version by version: the **Paiements** demo spec has two (2.2 and 2.3).

- **Publish** (write permission on the volume): from the contents, or from CI with an API token. A new version is created only if the spec actually changes; republishing the same spec does nothing.
- **OpenAPI block**: in a page, the OpenAPI button in the toolbar picks a spec and an operation. The block reads the live spec: parameters, body, responses, version chip, link to the operation in Redoc. It keeps a copy, shown if the spec disappears or the operation is removed from it.
- **Delete** a spec: volume admins. Blocks that reference it keep their copy.

```bash
curl -X POST "https://docs.example.com/api/projects/<volume>/specs?name=paiements" \
  -H "Authorization: Bearer andal_…" -H "Content-Type: application/yaml" \
  --data-binary @openapi.yaml
```

The spec's page shows this command with the volume's ID filled in.

## Public API and tokens

The entire API behind the UI (`/api/…`) can also be read and written with an **API token**, created in **My account** (account menu): a name, a scope (read, or read and write), a lifetime (7, 30, 90 or 365 days). The token is shown only once; Andal stores only a hash of it. It acts with your permissions, never more, and can be revoked with one click.

- A read token can only make `GET` requests.
- A token cannot touch passwords, accounts and groups, tokens, webhooks, Git sync or the assistant: those require a session.
- At most 20 active tokens per person; the last-used date is shown.

Page content can be exchanged as JSON (the editor document) or Markdown, and a replacement shows up live for anyone who has the page open:

```bash
curl -H "Authorization: Bearer andal_…" "https://docs.example.com/api/pages/<page>/content?format=markdown"
curl -X PUT -H "Authorization: Bearer andal_…" -H "Content-Type: text/markdown" \
  --data-binary @guide.md "https://docs.example.com/api/pages/<page>/content"
curl -X POST -H "Authorization: Bearer andal_…" -H "Content-Type: application/json" \
  -d '{"title":"Notes de version","markdown":"# 2.3\n\n- Jetons plus courts"}' \
  "https://docs.example.com/api/projects/<volume>/pages"
```

The Markdown follows GFM (tables, checkboxes), plus `> [!NOTE]` callouts, ```` ```mermaid ```` blocks and ```` ```openapi ```` blocks (`spec:` and `operation:`, which link the block to the volume's spec).

## Integrations

**Administration → Integrations** (workspace admins) sends events to other tools: page created, updated, moved to trash, comment, spec published.

- **Formats**: signed JSON (`X-Andal-Signature` header, HMAC-SHA256 of `timestamp.body` with the webhook secret), Slack or Mattermost (incoming webhook), Microsoft Teams (Adaptive Card).
- **Scope**: all volumes, or a single one; **events** of your choice. “Test” sends a ping; the last 50 deliveries are shown with their responses.
- An updated page is announced only after `WEBHOOK_UPDATE_DELAY` seconds of quiet (120 by default): one writing session, one message. A page under a read restriction is never announced.
- A failed delivery is retried, up to 6 attempts in total, spaced from 30 seconds to 8 minutes apart; a 4xx response (other than 408 and 429) stops the retries immediately. Private network addresses are rejected, including after DNS resolution, unless `WEBHOOK_ALLOW_PRIVATE=true`.

**Link previews**: hovering over a link to a GitHub issue or pull request, or to a Jira issue, shows a card with its title and status. `GITHUB_TOKEN` gives access to private repositories (without it: public repositories only, and 60 requests per hour); `JIRA_BASE_URL`, `JIRA_EMAIL` and `JIRA_API_TOKEN` connect Jira.

## Docs as code: Git sync

In a volume's settings (volume admins), **Git sync** links a folder in a repository to the volume: each Markdown file becomes a page, and each subfolder a parent page (its `README.md` or `index.md` provides the content).

- **Titles and order**: `title` and `position` from the YAML front matter, otherwise the first heading, otherwise the file name; without a position, file name order (`01-demarrer.md`).
- **Relative links** to other `.md` files become links between pages. **Images** from the repository become page attachments. `mermaid` and `openapi` blocks work as in the editor.
- Pages managed by the repository are read and commented on in Andal, and written in the repository: their banner links to the file on the Git host. Nobody can edit, rename or move them in Andal, admins included.
- A file removed from the repository moves its page to the trash; a changed page keeps its previous version in the history, and the change shows up live on open pages.
- **When**: on every push if the Git host calls the webhook shown (GitHub, GitLab, Gitea, Forgejo, signed with the secret shown), otherwise every 10 minutes, or on “Sync”.
- `https://` repositories only; a private repository needs a read token, which is kept on the server. **Detach** leaves the pages in place, and editable again.

## Templates, export and public links

**Page templates.** Besides a blank page, the new page dialog offers four templates for tech teams: **Architecture decision** (context, options, decision, consequences), **RFC**, **Runbook** (symptoms, diagnosis, remediation) and **Post-mortem** (timeline, root cause, blameless actions). The title starts with the template's prefix (“Decision: ”, “Runbook: ”…), and the content is written in the language of whoever creates the page. Through the API: `"template": "adr"` (or `rfc`, `runbook`, `postmortem`) when creating a page.

**Export.** The export button in the page header downloads the page:

- **Markdown**: the same Markdown as the API (GFM, callouts, `mermaid` and `openapi` blocks), with links to pages and files made absolute, pointing to this instance.
- **PDF**: laid out for print (A4) with its number and volume, numbered figures and listings, rendered Mermaid diagrams, draw.io diagrams and OpenAPI blocks, and page numbers in the footer. Comments are left out. The PDF is rendered by [Gotenberg](https://gotenberg.dev) (`GOTENBERG_URL`); without it, only Markdown is offered.

**Export volume**, in the volume menu (the “⋯” next to its name), downloads a zip archive: one Markdown file per page (`title` and `position` in the front matter), one folder per page that has subpages (its content in `index.md`), relative links between pages, and the files the pages use in `_fichiers/`. Only the pages you can read go in. The archive imports back as is, here or into another Andal.

**Public links.** In **Share**, a volume admin publishes a page (with or without its subpages) or the whole volume behind an unguessable address, `/s/…`. Anyone with the address can read it without an account: the published pages' content, numbering, diagrams and files; no comments, no history, no authors.

- A page restricted for reading is never public, not even through its parent's or its volume's link; links to it stay plain text, like links to pages outside the share.
- Removing the link cuts access immediately. Public pages are marked `noindex`. Every publication and removal goes to the audit log.
- `PUBLIC_LINKS=false` turns the feature off on a server.

## Import

**Import pages…**, in the volume menu, brings in a whole tree of pages:

- **Markdown**: a `.md` file, or a zipped folder: one folder per parent page (its `README.md` or `index.md`, or a `Page.md` next to a `Page/` folder), with images and files alongside. Titles and order work as in Git sync. An archive from “Export volume” imports back as is.
- **Notion**: the “Markdown & CSV” export, with subpages. The hierarchy and callouts are kept, databases become tables, and the identifiers Notion appends to names are dropped.
- **Confluence**: the HTML export of a space. The page tree comes from the export's index; info, note, warning and tip panels become callouts, code keeps its language, and tables, images and attachments come along. The XML export is not supported.

Rules:

- Importing creates pages, so it requires write permission where they land (the top level of the volume, or under a page). They take that place's permissions; nothing is replaced, they are added after the existing pages.
- The worker processes the archive in the background. The dialog follows it, then shows the number of pages and files and any notes (a file too large, a page outside the schema). Links between imported pages become links between pages; images and files become attachments.
- Limits: `IMPORT_MAX_MB` per archive (200 by default) and five times that once unpacked, 10,000 files, 2,000 pages, 2 MB of Markdown per page, `UPLOAD_MAX_MB` per attached file. The archive leaves storage once the import is over, whether it succeeded or not.

```bash
curl -X POST -H "Authorization: Bearer andal_…" -F parentId=<page> -F file=@export.zip \
  "https://docs.example.com/api/projects/<volume>/imports"
```

This needs a write token; `parentId` is optional and must come before the file. `GET /api/imports/<id>` returns the progress.

## Assistant

**⌘K** also answers questions: a query ending in “?”, or Shift + Enter. The answer streams in, cites its sources [1], [2], … and lists them below.

- The assistant only reads pages that **you** can read: the search runs first, with your permissions, and only those excerpts are sent to the model. A restricted page never leaves Andal on behalf of someone who cannot read it.
- **Administration → Assistant** (workspace admins) picks the model: **Claude** (Anthropic API key, `claude-opus-5-5` by default) or **any OpenAI-compatible API**, including local ones (Ollama, LM Studio, vLLM) so that nothing leaves your network. “Test” checks the connection; the key is never sent back to the browser. The `AI_*` variables set the default.
- 40 questions per hour per person.

## Operations

**Rate limiting.** The whole API is rate-limited per minute, in Valkey (shared by all instances): 600 reads and 120 writes per session or per token (API or SCIM), and 120 requests per IP address without a session. Every response carries `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset`; beyond the limit, the API returns 429 with `Retry-After`. The `/api/health` probe is never counted. Settings: `RATE_LIMIT_READS`, `RATE_LIMIT_WRITES`, `RATE_LIMIT_ANONYMOUS`, or `RATE_LIMIT=false` behind a gateway that handles it. Sign-in, two-factor authentication and the assistant also keep their own limits.

**Client address.** The API trusts `X-Forwarded-For` only from a trusted proxy: `TRUST_PROXY` (default `loopback,uniquelocal`, meaning the machine itself and private networks, where the Caddy from the compose file runs). Behind another proxy or a load balancer, set its address or network (`10.0.0.0/8`). Otherwise, anyone could claim any address they like and bypass the per-address limits.

**Multiple collab instances.** The Hocuspocus Redis extension syncs documents that are open on several instances through Valkey, and a lock lets only one of them save. API broadcasts (permissions, contents, notifications) reach every instance; the writes the API requests (comment anchor, restore, content via the API or Git sync) go through a Valkey queue: a single instance takes each one, and drops it if nobody is waiting for the answer anymore. In production: `docker compose … up -d --scale collab=3`; Caddy finds the instances through DNS.

**Rejected save.** When the collab server rejects content (outside the schema), everyone with the page open in the editor immediately sees a banner: nothing is saved while it is shown. It disappears as soon as a save goes through again, on any instance.

**Languages.** The UI is available in French and English: the browser language by default, then the choice made in My account or at the top of the sign-in screen; the account follows the language of the interface it is used in, so emails do too. API errors follow `Accept-Language`, and emails use the recipient's language (for an invitation, the inviting admin's language). French is the source language: each French sentence serves as its own key, and the English catalog lives in `apps/web/src/i18n/en/` (UI) and `packages/db/src/i18n-en.ts` (server).

## Project layout

```
apps/
  web/      React 19, Vite, Tailwind 4, TanStack Router and Query, TipTap 3
  api/      NestJS 11 on Fastify; files to S3 storage
  collab/   Hocuspocus 3 (Yjs), schema validation before writing
  worker/   BullMQ: text and links for search and backlinks, emails, purges (trash, files), webhooks, Git sync, imports
packages/
  authz/    Permission model, pure and tested
  db/       Kysely, migrations, seed, access queries, S3 storage
  editor/   TipTap schema shared by client and server (Mermaid, OpenAPI, draw.io, image, attachment, table, tasks, callout, comment), OpenAPI spec parsing, Markdown round-trip, page templates, HTML rendering for PDF
  ui/       Design tokens (CSS) and base components
deploy/     Images, production compose, Caddy (see deploy/README.md)
tests/e2e/  End-to-end suites (Python, no dependencies)
infra/      Keycloak dev realm
```

## Permission model

- Per-volume roles: reader, commenter, editor, admin. They are granted to a person or a group; the strongest one wins.
- The workspace owner and admins are admins of every volume.
- A page can be restricted for **reading** (for anyone not on the list, the page does not exist: 404, absent from the contents and search) or for **writing** (for anyone not on the list, the role is capped at commenter).
- Restrictions are inherited from parent pages and only ever reduce permissions, never widen them.
- An archived volume caps everyone at read; only the underlying role decides who can unarchive it.
- Deny by default. Checks happen in the API **and** in the collab server: a connection without edit permission is opened read-only there, whatever the client.

## Testing

```bash
pnpm test
```

Runs the tests for the permission model, the editor schema (OpenAPI specs, Markdown), webhooks (signature, network guard), one-time codes (RFC 6238 test vectors) and server message translation.

```bash
tests/e2e/run.sh
```

With the stack running: the end-to-end suites (accounts, access and notifications, pages, versions, volumes, files and links, specs, public API and webhooks, Git sync, templates, exports, public links and imports, assistant, two-factor authentication, sessions and audit log, SCIM and SSO groups, rate limiting), then the three collab server checks below. Each suite starts from the demo data; `tests/e2e/run.sh files_links_test` runs just one. GitHub CI runs them on every commit, against a full stack.

```bash
pnpm --filter @andal/collab check:readonly
```

With the stack running: connects to the collab server as Léa, attempts a raw write to the Yjs document, and checks that the database did not change. `check:readonly aminata` runs the counter-test: the write goes through. Run `pnpm db:seed` afterwards to clean up.

```bash
pnpm --filter @andal/collab check:live-access
```

With the stack running: Aminata writes on “Glossaire” (Glossary) over an open connection, then Camille removes her write access, then her read access. Checks that the same connection switches to read-only, then gets closed. Next, Camille archives the Paiements volume while Aminata has “Conventions” open: the page switches to read-only, then becomes editable again when the volume is unarchived. Run `pnpm db:seed` afterwards.

```bash
pnpm --filter @andal/collab check:multi
```

With the stack running: starts a second collab instance (port 3012) and checks that an edit made on one instance reaches the browsers on the other, that a write through the API is applied only once (a single version), and that rejected content is reported to editors on both instances, then that saving resumes.

## Deployment

Docker images, production compose behind Caddy (automatic TLS, strict CSP), first account, backups and upgrades: see [deploy/README.md](deploy/README.md). CI publishes `ghcr.io/open226bf/andal-server` and `andal-web` on every commit to `main` (tag `edge`) and on every `v*` release (tags `0.1.0`, `0.1` and `latest` for `v0.1.0`).

```bash
pnpm --filter @andal/collab check:deploy
```

With `ANDAL_URL`, `ANDAL_USER` and `ANDAL_PASSWORD` set: checks a deployed installation, from HTTPS to real-time collaboration.

## What's left to do

- **Accounts**: passkeys (WebAuthn) in addition to one-time codes; a workspace setting to make two-factor authentication mandatory.
- **Directory**: SCIM manages neither workspace roles nor volumes (volumes are opened to groups); no bulk operations.
- **Access management**: a workspace setting to restrict volume creation to admins (`canCreateProject` already provides for it); configurable retention for the audit log.
- **Comments**: editing a message after it has been sent; thread creation on mobile still needs testing on a real phone.
- **Notifications**: a notification that arrives while the digest email is being sent waits for the next email; no notifications yet for changes to followed pages.
- **Library**: ordering your shelf by hand (currently by volume number); dragging a volume from one aisle to another in the library.
- **Pages**: comparing two versions (currently you view them one after the other); collapsing sections in the contents.
- **Files**: draw.io diagrams are still stored as data URIs in the document, not in storage.
- **Specs**: comparing two versions of a spec (added, removed and breaking routes); AsyncAPI or GraphQL specs.
- **Git sync**: one-way only (repository → Andal); proposing a change from Andal would open a pull request.
- **Assistant**: search is full-text (French); semantic search (embeddings, pgvector) would handle poorly worded questions better.
- **Migration**: Confluence's XML export is not imported, nor are comments and history from Confluence or Notion; Notion databases arrive as static tables; a public link has neither an expiry date nor a password; no PDF of a whole volume yet.
- **Scaling**: multiple API instances behind Caddy (the API is already stateless: sessions, rate limits and queues live in Valkey).
- **Hardening**: PostgreSQL RLS as a second barrier; encrypting two-factor authentication secrets and integration keys in the database.
- **Languages**: the demo content and the SCIM API messages remain in French; each additional language needs another catalog.
- **Performance**: the main bundle is about 1.1 MB minified; load the editor on demand in Read mode.
- **Open decision**: numbering is computed over all pages so that it stays stable across readers. Someone who cannot see 4.1 therefore sees “4.2 Astreinte” (On-call) and can infer that a page 4.1 exists.

## License

Apache-2.0, see [LICENSE](LICENSE).
