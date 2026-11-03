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
import { GroupsController } from './groups/groups.controller.js';
import { GroupsService } from './groups/groups.service.js';
import { HealthController } from './health.controller.js';
import { InfraModule } from './infra.module.js';
import { MailService } from './mail.service.js';
import { NotificationsController } from './notifications/notifications.controller.js';
import { NotificationsService } from './notifications/notifications.service.js';
import { PagesController } from './pages/pages.controller.js';
import { PagesService } from './pages/pages.service.js';
import { ProjectsController } from './projects/projects.controller.js';
import { RayonsController } from './rayons/rayons.controller.js';
import { RayonsService } from './rayons/rayons.service.js';
import { ProjectsService } from './projects/projects.service.js';
import { VersionsService } from './pages/versions.service.js';

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
  ],
  providers: [
    AuditService,
    MailService,
    CollabBridgeService,
    DocsService,
    AccessService,
    PagesService,
    ProjectsService,
    RayonsService,
    VersionsService,
    CommentsService,
    NotificationsService,
    AccountsService,
    GroupsService,
    SessionsService,
    LoginThrottleService,
    OidcService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
