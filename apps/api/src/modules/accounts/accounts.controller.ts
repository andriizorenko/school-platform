import { Body, Controller, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { RequestId } from "../../common/request-id.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { Public } from "../auth/public.decorator";
import type { AuthUser } from "../auth/types";
import { RequirePermissions } from "../iam/require-permissions.decorator";
import { AcceptInvitationDto, CreateStudentAccountDto, ForgotPasswordDto, ResetPasswordDto, SuspendUserDto } from "./dto/account.dto";
import { AccountsService } from "./accounts.service";
@Controller()
export class AccountsController {constructor(private readonly accounts:AccountsService){}
  @RequirePermissions("user.invite") @Post("users/:id/invite") invite(@Param("id",ParseUUIDPipe) id:string,@CurrentUser() u:AuthUser,@RequestId() rid?:string){return this.accounts.invite(id,u,rid);}
  @Public() @Post("auth/invitations/accept") accept(@Body() dto:AcceptInvitationDto){return this.accounts.acceptInvitation(dto.token,dto.password);}
  @Public() @Post("auth/password/forgot") forgot(@Body() dto:ForgotPasswordDto){return this.accounts.forgot(dto.email);}
  @Public() @Post("auth/password/reset") reset(@Body() dto:ResetPasswordDto){return this.accounts.reset(dto.token,dto.password);}
  @RequirePermissions("user.suspend") @Post("users/:id/suspend") suspend(@Param("id",ParseUUIDPipe) id:string,@Body() dto:SuspendUserDto,@CurrentUser() u:AuthUser,@RequestId() rid?:string){return this.accounts.suspend(id,dto.reason,u,rid);}
  @RequirePermissions("user.suspend") @Post("users/:id/restore") restore(@Param("id",ParseUUIDPipe) id:string,@CurrentUser() u:AuthUser,@RequestId() rid?:string){return this.accounts.restore(id,u,rid);}
  @RequirePermissions("student.manage") @Post("students/:id/account") child(@Param("id",ParseUUIDPipe) id:string,@Body() dto:CreateStudentAccountDto,@CurrentUser() u:AuthUser,@RequestId() rid?:string){return this.accounts.createStudentAccount(id,dto.email,u,rid);}
}
