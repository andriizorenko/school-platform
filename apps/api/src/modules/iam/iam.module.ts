import { Module } from "@nestjs/common";
import { IamService } from "./iam.service";

@Module({
  providers: [IamService],
  exports: [IamService],
})
export class IamModule {}
