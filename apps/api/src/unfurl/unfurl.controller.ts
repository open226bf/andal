import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { UnfurlService } from './unfurl.service.js';

@Controller()
export class UnfurlController {
  constructor(private readonly unfurls: UnfurlService) {}

  /** `?url=https://github.com/org/repo/pull/12`: titre et état, pour l'aperçu au survol. */
  @Get('unfurl')
  unfurl(@Query('url') url = '') {
    const value = String(url);
    if (!/^https:\/\//.test(value) || value.length > 500) throw new BadRequestException('Adresse https attendue.');
    return this.unfurls.unfurl(value);
  }
}
