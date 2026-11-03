import { Injectable } from '@nestjs/common';
import { renderMail, type Mail } from '@andal/db';
import nodemailer, { type Transporter } from 'nodemailer';
import { config } from './env.js';

export type { Mail };

/** Emails transactionnels, rendus par @andal/db (le worker envoie les mêmes). */
@Injectable()
export class MailService {
  private transporter?: Transporter;

  get enabled(): boolean {
    return config.mail !== null;
  }

  /** Renvoie false si l'envoi est désactivé ou a échoué: l'appelant remet alors le lien autrement. */
  async send(mail: Mail): Promise<boolean> {
    if (!config.mail) return false;
    this.transporter ??= nodemailer.createTransport(config.mail.url);
    try {
      await this.transporter.sendMail({ from: config.mail.from, to: mail.to, subject: mail.subject, ...renderMail(mail) });
      return true;
    } catch (error) {
      console.error(`Envoi d'email impossible vers ${mail.to}:`, error);
      return false;
    }
  }
}
