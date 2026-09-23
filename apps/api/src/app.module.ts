import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { AuditModule } from "./modules/audit/audit.module";
import { AuthModule } from "./modules/auth/auth.module";
import { SessionAuthGuard } from "./modules/auth/session-auth.guard";
import { MfaGuard } from "./modules/auth/mfa.guard";
import { DatabaseModule } from "./common/database/database.module";
import { HealthController } from "./common/health/health.controller";
import { IamModule } from "./modules/iam/iam.module";
import { PermissionsGuard } from "./modules/iam/permissions.guard";
import { ApiExceptionFilter } from "./common/errors/api-exception.filter";
import { StaffModule } from "./modules/staff/staff.module";
import { StudentsModule } from "./modules/students/students.module";
import { FamiliesModule } from "./modules/families/families.module";
import { SubjectsModule } from "./modules/subjects/subjects.module";
import { TeachersModule } from "./modules/teachers/teachers.module";
import { EnrollmentsModule } from "./modules/enrollments/enrollments.module";
import { SchedulingModule } from "./modules/scheduling/scheduling.module";
import { BillingModule } from "./modules/billing/billing.module";
import { LessonsModule } from "./modules/lessons/lessons.module";
import { PortalModule } from "./modules/portal/portal.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { ReportsModule } from "./modules/reports/reports.module";
import { OpsModule } from "./modules/ops/ops.module";
import { PayrollModule } from "./modules/payroll/payroll.module";
import { CoursesModule } from "./modules/courses/courses.module";
import { AccountsModule } from "./modules/accounts/accounts.module";
import { PromotionsModule } from "./modules/promotions/promotions.module";
import { FilesModule } from "./modules/files/files.module";
import { HistoryModule } from "./modules/history/history.module";
import { validateEnvironment } from "./common/config/validate-env";
import { ObservabilityModule } from "./common/observability/observability.module";
import { SecurityModule } from "./common/security/security.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ["../../.env", ".env"], validate: validateEnvironment }),
    DatabaseModule,
    ObservabilityModule,
    SecurityModule,
    IamModule,
    AuditModule,
    AuthModule,
    FamiliesModule,
    StudentsModule,
    StaffModule,
    SubjectsModule,
    TeachersModule,
    EnrollmentsModule,
    SchedulingModule,
    BillingModule,
    LessonsModule,
    PortalModule,
    NotificationsModule,
    ReportsModule,
    OpsModule,
    PayrollModule,
    CoursesModule,
    AccountsModule,
    PromotionsModule,
    FilesModule,
    HistoryModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: ApiExceptionFilter,
    },
    {
      provide: APP_GUARD,
      useClass: SessionAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: MfaGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard,
    },
  ],
})
export class AppModule {}
