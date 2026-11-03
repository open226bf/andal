import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { config } from '../env.js';
import { VALKEY } from '../infra.module.js';

export type Unfurl =
  | { kind: 'github'; type: 'issue' | 'pull'; repo: string; number: number; title: string; state: 'open' | 'closed' | 'merged' | 'draft'; author: string | null; url: string }
  | { kind: 'jira'; key: string; summary: string; status: string; category: 'new' | 'indeterminate' | 'done'; type: string | null; url: string };

const GITHUB = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(issues|pull)\/(\d+)(?:[/?#].*)?$/;
const JIRA_KEY = /\/browse\/([A-Z][A-Z0-9_]+-\d+)(?:[/?#].*)?$/;
const CACHE_SECONDS = 600;

/**
 * Aperçu des liens GitHub (tickets, pull requests) et Jira dans les pages.
 * Les hôtes interrogés sont fixes (api.github.com, JIRA_BASE_URL): une URL
 * fournie par l'utilisateur ne choisit jamais où le serveur se connecte.
 */
@Injectable()
export class UnfurlService {
  constructor(@Inject(VALKEY) private readonly valkey: Redis) {}

  async unfurl(raw: string): Promise<Unfurl> {
    const url = raw.trim();
    const cacheKey = `unfurl:${url}`;
    const cached = await this.valkey.get(cacheKey);
    if (cached === 'none') throw new NotFoundException('Aperçu indisponible.');
    if (cached) return JSON.parse(cached) as Unfurl;

    let result: Unfurl | null = null;
    try {
      result = (await this.github(url)) ?? (await this.jira(url));
    } catch (error) {
      console.warn(`Aperçu de ${url} impossible:`, error instanceof Error ? error.message : error);
      throw new NotFoundException('Aperçu indisponible pour le moment.');
    }
    // Un échec aussi se garde un moment: pas de nouvelle requête à chaque survol.
    await this.valkey.set(cacheKey, result ? JSON.stringify(result) : 'none', 'EX', result ? CACHE_SECONDS : 120);
    if (!result) throw new NotFoundException('Aperçu indisponible.');
    return result;
  }

  private async github(url: string): Promise<Unfurl | null> {
    const match = GITHUB.exec(url);
    if (!match) return null;
    const [, owner, repo, kind, number] = match as unknown as [string, string, string, 'issues' | 'pull', string];
    const headers: Record<string, string> = { accept: 'application/vnd.github+json', 'user-agent': 'Andal', 'x-github-api-version': '2022-11-28' };
    if (config.githubToken) headers.authorization = `Bearer ${config.githubToken}`;
    const endpoint = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${kind === 'pull' ? 'pulls' : 'issues'}/${number}`;
    const response = await fetch(endpoint, { headers, signal: AbortSignal.timeout(5000) });
    if (response.status === 404 || response.status === 403) return null;
    if (!response.ok) throw new Error(`GitHub ${response.status}`);
    const data = (await response.json()) as { title: string; state: 'open' | 'closed'; draft?: boolean; merged_at?: string | null; user?: { login: string } | null; html_url: string; pull_request?: unknown };
    const pull = kind === 'pull' || data.pull_request !== undefined;
    const state = pull && data.merged_at ? 'merged' : pull && data.draft && data.state === 'open' ? 'draft' : data.state;
    return { kind: 'github', type: pull ? 'pull' : 'issue', repo: `${owner}/${repo}`, number: Number(number), title: data.title, state, author: data.user?.login ?? null, url: data.html_url };
  }

  private async jira(url: string): Promise<Unfurl | null> {
    const jira = config.jira;
    if (!jira || !url.startsWith(`${jira.baseUrl}/`)) return null;
    const key = JIRA_KEY.exec(url)?.[1];
    if (!key) return null;
    const response = await fetch(`${jira.baseUrl}/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,status,issuetype`, {
      headers: { accept: 'application/json', authorization: `Basic ${Buffer.from(`${jira.email}:${jira.token}`).toString('base64')}` },
      signal: AbortSignal.timeout(5000),
      redirect: 'error',
    });
    if (response.status === 404 || response.status === 403 || response.status === 401) return null;
    if (!response.ok) throw new Error(`Jira ${response.status}`);
    const data = (await response.json()) as { key: string; fields: { summary: string; status?: { name: string; statusCategory?: { key: string } }; issuetype?: { name: string } } };
    const category = data.fields.status?.statusCategory?.key;
    return {
      kind: 'jira',
      key: data.key,
      summary: data.fields.summary,
      status: data.fields.status?.name ?? '',
      category: category === 'done' ? 'done' : category === 'indeterminate' ? 'indeterminate' : 'new',
      type: data.fields.issuetype?.name ?? null,
      url: `${jira.baseUrl}/browse/${data.key}`,
    };
  }
}
