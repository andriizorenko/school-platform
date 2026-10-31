import { Module } from "@nestjs/common";
import { TeacherReviewsController } from "./teacher-reviews.controller";
import { TeacherReviewsService } from "./teacher-reviews.service";

@Module({
  controllers: [TeacherReviewsController],
  providers: [TeacherReviewsService],
})
export class TeacherReviewsModule {}
