import { Controller, Get, Param, ParseUUIDPipe, Post, Req, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { RequestId } from "../../common/request-id.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthUser } from "../auth/types";
import { RequirePermissions } from "../iam/require-permissions.decorator";
import { FilesService } from "./files.service";

@Controller("files")
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @RequirePermissions("course.manage")
  @Post()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 30 * 1024 * 1024 } }))
  async upload(@UploadedFile() file: any, @CurrentUser() user: AuthUser, @Req() req: any, @RequestId() requestId?: string) {
    if (!file) throw new Error("File required");
    return this.files.upload(file, user, req.body?.type || "OTHER", requestId);
  }

  @RequirePermissions("course.view")
  @Get(":id/meta")
  meta(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.files.meta(id, user);
  }

  @RequirePermissions("course.view")
  @Get(":id/content")
  async content(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @Res() res: Response) {
    const { asset, buffer } = await this.files.content(id, user);
    res.setHeader("content-type", asset.mime_type || "application/octet-stream");
    res.setHeader("content-disposition", `inline; filename*=UTF-8''${encodeURIComponent(asset.original_filename || "file")}`);
    res.setHeader("cache-control", "private, max-age=300");
    res.setHeader("x-content-type-options", "nosniff");
    res.send(buffer);
  }
}
