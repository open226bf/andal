import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccessController } from './access/access.controller.js';
import { AccessService } from './access/access.service.js';
import { AccountLinksController, AdminAccountsController } from './accounts/accounts.controller.js';
import { AccountsService } from './accounts/accounts.service.js';
import { AuditService } from './audit.service.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthGuard } from './auth/auth.guard.js';
import { LoginThrottleService } from './auth/login-throttle.service.js';
import { OidcService } from './auth/oidc.service.js';
import { SessionsService } from './auth/sessions.service.js';
import { CollabBridgeService } from './collab-bridge.service.js';
import { CommentsController } from './comments/comments.controller.js';
import { CommentsService } from './comments/comments.service.js';
import { DocsController } from './docs/docs.controller.js';
import { DocsService } from './docs/docs.service.js';
import { FilesController } from './files/files.controller.js';
import { FilesService } from './files/files.service.js';
import { GroupsController } from './groups/groups.controller.js';
import { GroupsService } from './groups/groups.service.js';
import { HealthController } from './health.controller.js';
import { InfraModule } from './infra.module.js';
import { MailService } from './mail.service.js';
import { NotificationsController } from './notifications/notifications.controller.js';
import { NotificationsService } from './notifications/notifications.service.js';
import { PagesController } from './pages/pages.controller.js';
import { ContentService } from './pages/content.service.js';
import { PagesService } from './pages/pages.service.js';
import { ProjectsController } from './projects/projects.controller.js';
import { RayonsController } from './rayons/rayons.controller.js';
import { RayonsService } from './rayons/rayons.service.js';
import { SpecsController } from './specs/specs.controller.js';
import { SpecsService } from './specs/specs.service.js';
import { TokensController } from './tokens/tokens.controller.js';
import { TokensService } from './tokens/tokens.service.js';
import { AskController } from './ask/ask.controller.js';
import { AskService } from './ask/ask.service.js';
import { GitController } from './git/git.controller.js';
import { GitService } from './git/git.service.js';
import { UnfurlController } from './unfurl/unfurl.controller.js';
import { UnfurlService } from './unfurl/unfurl.service.js';
import { EventsService } from './webhooks/events.service.js';
import { WebhooksController } from './webhooks/webhooks.controller.js';
import { WebhooksService } from './webhooks/webhooks.service.js';
import { ProjectsService } from './projects/projects.service.js';
import { MfaService } from './auth/mfa.service.js';
import { ScimAdminController, ScimController } from './scim/scim.controller.js';
import { ScimService } from './scim/scim.service.js';
import { AuditController } from './security/audit.controller.js';
import { AdminSecurityController, SecurityController } from './security/security.controller.js';
import { VersionsService } from './pages/versions.service.js';
import { RateLimitGuard } from './rate-limit.guard.js';

@Module({
  imports: [InfraModule],
  controllers: [
    HealthController,
    AuthController,
    AccountLinksController,
    AdminAccountsController,
    GroupsController,
    DocsController,
    AccessController,
    PagesController,
    ProjectsController,
    RayonsController,
    CommentsController,
    NotificationsController,
    FilesController,
    SpecsController,
    TokensController,
    WebhooksController,
    UnfurlController,
    GitController,
    AskController,
    SecurityController,
    AdminSecurityController,
    AuditController,
    ScimController,
    ScimAdminController,
  ],
  providers: [
    AuditService,
    MailService,
    CollabBridgeService,
    DocsService,
    AccessService,
    PagesService,
    ContentService,
    ProjectsService,
    RayonsService,
    VersionsService,
    CommentsService,
    NotificationsService,
    FilesService,
    SpecsService,
    TokensService,
    WebhooksService,
    EventsService,
    UnfurlService,
    GitService,
    AskService,
    AccountsService,
    GroupsService,
    SessionsService,
    LoginThrottleService,
    OidcService,
    MfaService,
    ScimService,
    // Dans cet ordre: on sait qui appelle avant de compter.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
})
export class AppModule {}
