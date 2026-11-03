# Changelog

[Français](CHANGELOG.fr.md) · **English**

Docker images: `ghcr.io/open226bf/andal-server` and `ghcr.io/open226bf/andal-web`, tagged with the version (`0.1.0`), its minor line (`0.1`) and `latest`. To upgrade, see [deploy/README.md](deploy/README.md#upgrading).

## 0.1.0 (2026-11-03)

The first release. It covers writing, permissions, security and self-hosting; migrating from another tool (import, export, templates, public sharing) comes next.

### Writing and reading

- **Volumes** in a library arranged by aisles, with a personal shelf; create, configure, archive and delete.
- **Numbered pages** in a contents tree: drag and drop, trash with automatic purge, history grouped by work session, restoring a version.
- **Real-time collaborative editing** (TipTap, Yjs): Mermaid, OpenAPI and draw.io blocks, code, callouts, images and files, tables, task lists.
- **Links between pages**: page search as you type, previews on hover, backlinks (“Cited in”).
- **Comments** anchored in the text, mentions, notifications in the app and by email.
- **Search** across every volume you can read (⌘K).

### Permissions

- Per-volume roles (read, comment, write, admin) for people and groups.
- Read or write restrictions per page, inherited by subpages.
- Checked in the API and in the collab server; a change applies immediately, including on pages that are already open.

### Accounts and security

- Local passwords, and OpenID Connect SSO in the free core.
- Two-factor authentication (one-time codes and recovery codes), open sessions you can close, append-only audit log.
- SCIM for accounts and groups; groups synced from the SSO provider at each sign-in.
- Rate limiting on the whole API, strict CSP, uploaded files served under `CSP: sandbox`.

### For tech teams

- **OpenAPI specs** stored and versioned per volume, opened in Redoc, publishable from CI.
- **Public API** with tokens; page content in and out as JSON or Markdown.
- **Integrations**: webhooks (signed JSON, Slack, Mattermost, Teams), GitHub and Jira link previews.
- **Git sync**: a folder of Markdown files in a repository becomes pages of a volume, kept up to date on every push (or every 10 minutes).
- **Assistant**: answers from the pages you can read, with sources; Claude or any OpenAI-compatible model, local ones included.

### Operations

- Images for `linux/amd64` and `linux/arm64`; production compose behind Caddy with automatic TLS; first account, backups and upgrades documented.
- Several collab instances behind Caddy, kept in sync through Valkey.
- Interface in French and English.

### Not there yet

Import (Confluence, Notion, Markdown), PDF export, page templates and public sharing are the next milestone. The full list is in [What's left to do](README.md#whats-left-to-do).
