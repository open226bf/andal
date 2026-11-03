import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { type AuthContext, CurrentAuth } from '../auth/auth.guard.js';
import { DocsService } from './docs.service.js';

@Controller()
export class DocsController {
  constructor(private readonly docs: DocsService) {}

  @Get('projects')
  projects(@CurrentAuth() auth: AuthContext) {
    return this.docs.listProjects(auth.subject, auth.user.workspace_id);
  }

  @Get('projects/:slug/tree')
  tree(@CurrentAuth() auth: AuthContext, @Param('slug') slug: string) {
    return this.docs.tree(auth.subject, slug, auth.user.workspace_id);
  }

  @Get('pages/:id')
  page(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.docs.page(auth.subject, id);
  }

  @Get('pages/:id/sharing')
  sharing(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.docs.sharing(auth.subject, id);
  }

  @Get('search')
  search(@CurrentAuth() auth: AuthContext, @Query('q') q = '') {
    return this.docs.search(auth.subject, auth.user.workspace_id, String(q));
  }
}
