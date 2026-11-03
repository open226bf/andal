/** Emails transactionnels: texte brut et HTML sobre, sans image ni traceur. Partagé par l'API et le worker. */

export interface Mail {
  to: string;
  subject: string;
  /** Paragraphes du message, dans l'ordre. */
  lines: string[];
  /** Citation mise en retrait (extrait de commentaire), facultative. */
  quotes?: string[];
  action: { label: string; url: string };
  footer: string;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function renderMail(mail: Mail): { text: string; html: string } {
  const quotes = mail.quotes ?? [];
  const text = [...mail.lines, ...quotes.map((q) => `> ${q.replaceAll('\n', '\n> ')}`), `${mail.action.label} : ${mail.action.url}`, mail.footer].join('\n\n');
  const html = [
    '<div style="font-family:system-ui,sans-serif;font-size:16px;line-height:1.5;color:#161a23;max-width:520px">',
    ...mail.lines.map((line) => `<p>${escapeHtml(line)}</p>`),
    ...quotes.map((q) => `<blockquote style="margin:0 0 12px;padding-left:12px;border-left:3px solid #d8dbe2;color:#3d4250;white-space:pre-wrap">${escapeHtml(q)}</blockquote>`),
    `<p><a href="${escapeHtml(mail.action.url)}" style="display:inline-block;background:#161a23;color:#fff;padding:10px 16px;border-radius:10px;text-decoration:none;font-weight:600">${escapeHtml(mail.action.label)}</a></p>`,
    `<p style="font-size:13px;color:#5b6170">${escapeHtml(mail.footer)}</p>`,
    '</div>',
  ].join('');
  return { text, html };
}
