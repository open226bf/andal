import { type ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { localeFromHeader, translateMessage } from '@andal/db';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Les erreurs de l'API sont rédigées en français; pour un client qui demande
 * l'anglais (Accept-Language), le message part traduit, même forme de réponse.
 */
@Catch(HttpException)
export class I18nExceptionFilter extends BaseExceptionFilter {
  override catch(exception: HttpException, host: ArgumentsHost) {
    const request = host.switchToHttp().getRequest<FastifyRequest>();
    const locale = localeFromHeader(request.headers['accept-language']);
    if (locale === 'fr') return super.catch(exception, host);
    const status = exception.getStatus();
    const response = exception.getResponse();
    const body =
      typeof response === 'string'
        ? { statusCode: status, message: translateMessage(response, locale) }
        : {
            ...(response as Record<string, unknown>),
            message: Array.isArray((response as { message?: unknown }).message)
              ? ((response as { message: unknown[] }).message.map((m) => (typeof m === 'string' ? translateMessage(m, locale) : m)) as unknown[])
              : typeof (response as { message?: unknown }).message === 'string'
                ? translateMessage((response as { message: string }).message, locale)
                : (response as { message?: unknown }).message,
          };
    void host.switchToHttp().getResponse<FastifyReply>().status(status).send(body);
  }
}
