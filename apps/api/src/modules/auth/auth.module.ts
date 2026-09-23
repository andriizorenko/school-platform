import { Module } from "@nestjs/common";
import { IamModule } from "../iam/iam.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { SessionAuthGuard } from "./session-auth.guard";
import { MfaService } from "./mfa.service";
@Module({imports:[IamModule],controllers:[AuthController],providers:[AuthService,SessionAuthGuard,MfaService],exports:[AuthService,SessionAuthGuard,MfaService]})
export class AuthModule {}
