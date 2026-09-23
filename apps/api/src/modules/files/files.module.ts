import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { FilesController } from "./files.controller";
import { FilesService } from "./files.service";

@Module({ imports: [AuditModule], controllers: [FilesController], providers: [FilesService] })
export class FilesModule {}
