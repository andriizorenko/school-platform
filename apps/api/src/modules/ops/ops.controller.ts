import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { RequestId } from "../../common/request-id.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { Public } from "../auth/public.decorator";
import type { AuthUser } from "../auth/types";
import { RequirePermissions } from "../iam/require-permissions.decorator";
import { CreateLeadDto } from "./dto/create-lead.dto";
import { UpdateLeadDto } from "./dto/update-lead.dto";
import { UpdateSettingDto } from "./dto/update-setting.dto";
import { CreateTeacherApplicationDto } from "./dto/create-teacher-application.dto";
import { ReviewTeacherApplicationDto } from "./dto/review-teacher-application.dto";
import { ResolvePaymentReconciliationDto } from "./dto/resolve-payment-reconciliation.dto";
import { OpsService } from "./ops.service";

@Controller()
export class OpsController {
  constructor(private readonly ops:OpsService){}
  @RequirePermissions("ops.dashboard.view") @Get("ops/dashboard") dashboard(@CurrentUser() u:AuthUser){return this.ops.dashboard(u);}
  @RequirePermissions("family.view") @Get("ops/families") families(@CurrentUser() u:AuthUser,@Query("search") search?:string,@Query("manager") manager?:string,@Query("lifecycle") lifecycle?:string){return this.ops.families({search,manager,lifecycle},u);}
  @RequirePermissions("student.view") @Get("ops/students") students(@CurrentUser() u:AuthUser,@Query("search") search?:string,@Query("manager") manager?:string,@Query("status") status?:string,@Query("subject") subject?:string,@Query("teacher") teacher?:string,@Query("balance") balance?:string,@Query("lifecycle") lifecycle?:string){return this.ops.students({search,manager,status,subject,teacher,balance,lifecycle},u);}
  @RequirePermissions("finance.analytics.view") @Get("ops/finance") finance(){return this.ops.financeOverview();}
  @RequirePermissions("finance.analytics.view") @Get("ops/analytics") analytics(@Query("from") from?:string,@Query("to") to?:string,@Query("bucket") bucket?:string){return this.ops.analytics({from,to,bucket});}
  @RequirePermissions("billing.view") @Get("ops/payments") payments(@Query("limit") limit?:string){return this.ops.payments(Number(limit??100));}
  @RequirePermissions("billing.reconcile") @Get("ops/payment-reconciliation") paymentReconciliation(@Query("limit") limit?:string){return this.ops.paymentReconciliation(Number(limit??100));}
  @RequirePermissions("billing.reconcile") @Post("ops/payment-reconciliation/:eventId/resolve") resolvePaymentReconciliation(@Param("eventId",ParseUUIDPipe) eventId:string,@Body() dto:ResolvePaymentReconciliationDto,@CurrentUser() u:AuthUser,@RequestId() rid?:string){return this.ops.resolvePaymentReconciliation(eventId,dto.note,u,rid);}
  @RequirePermissions("audit.view") @Get("ops/audit") audit(@Query("limit") limit?:string){return this.ops.auditLog(Number(limit??100));}
  @RequirePermissions("settings.manage") @Get("settings") settings(){return this.ops.settings();}
  @RequirePermissions("settings.manage") @Get("settings/:key/history") settingHistory(@Param("key") key:string,@Query("limit") limit?:string){return this.ops.settingHistory(key,Number(limit??50));}
  @RequirePermissions("settings.manage") @Patch("settings/:key") setting(@Param("key") key:string,@Body() dto:UpdateSettingDto,@CurrentUser() u:AuthUser,@RequestId() rid?:string){return this.ops.updateSetting(key,dto.value,u,rid);}

  @Public() @Post("leads/public") publicLead(@Body() dto:CreateLeadDto){return this.ops.createLead(dto);}
  @RequirePermissions("lead.manage") @Post("leads") lead(@Body() dto:CreateLeadDto,@CurrentUser() u:AuthUser){return this.ops.createLead(dto,u);}
  @RequirePermissions("lead.view") @Get("leads") leads(@Query("status") status?:string){return this.ops.leads(status);}
  @RequirePermissions("lead.manage") @Patch("leads/:id") updateLead(@Param("id",ParseUUIDPipe) id:string,@Body() dto:UpdateLeadDto,@CurrentUser() u:AuthUser,@RequestId() rid?:string){return this.ops.updateLead(id,dto,u,rid);}

  @Public() @Post("teacher-applications/public") teacherApplication(@Body() dto:CreateTeacherApplicationDto){return this.ops.createTeacherApplication(dto);}
  @RequirePermissions("teacher.manage") @Get("teacher-applications") teacherApplications(@Query("status") status?:string){return this.ops.teacherApplications(status);}
  @RequirePermissions("teacher.manage") @Patch("teacher-applications/:id/review") reviewTeacherApplication(@Param("id",ParseUUIDPipe) id:string,@Body() dto:ReviewTeacherApplicationDto,@CurrentUser() u:AuthUser,@RequestId() rid?:string){return this.ops.reviewTeacherApplication(id,dto.status,u,rid,dto.comment);}
}
