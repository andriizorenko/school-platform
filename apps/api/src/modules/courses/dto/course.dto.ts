import {
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from "class-validator";

export class CreateCourseDto {
  @IsUUID() @IsOptional() subjectId?: string;
  @IsString() title!: string;
  @IsString() slug!: string;
  @IsString() @IsOptional() description?: string;
  @IsUUID() @IsOptional() coverAssetId?: string;
}

export class UpdateCourseDto {
  @IsString() @IsOptional() title?: string;
  @IsString() @IsOptional() slug?: string;
  @IsString() @IsOptional() description?: string;
  @IsUUID() @IsOptional() subjectId?: string;
  @IsUUID() @IsOptional() coverAssetId?: string;
}

export class CreateModuleDto {
  @IsString() title!: string;
  @IsString() @IsOptional() description?: string;
  @IsInt() @Min(1) position!: number;
}

export class UpdateModuleDto {
  @IsString() @IsOptional() title?: string;
  @IsString() @IsOptional() description?: string;
}

export class CreateCourseLessonDto {
  @IsString() title!: string;
  @IsString() @IsOptional() description?: string;
  @IsInt() @Min(1) position!: number;
  @IsInt() @Min(1) @IsOptional() estimatedMinutes?: number;
}

export class UpdateCourseLessonDto {
  @IsString() @IsOptional() title?: string;
  @IsString() @IsOptional() description?: string;
  @IsInt() @Min(1) @IsOptional() estimatedMinutes?: number;
}

export class CreateBlockDto {
  @IsIn(["TEXT", "PDF", "TEST"]) type!: "TEXT" | "PDF" | "TEST";
  @IsInt() @Min(1) position!: number;
  @IsObject() @IsOptional() content?: Record<string, unknown>;
  @IsUUID() @IsOptional() assetId?: string;
  @IsUUID() @IsOptional() testId?: string;
}

export class UpdateBlockDto {
  @IsObject() @IsOptional() content?: Record<string, unknown>;
  @IsUUID() @IsOptional() assetId?: string;
  @IsUUID() @IsOptional() testId?: string;
}

export class ReorderDto {
  @IsArray() @IsUUID("4", { each: true }) ids!: string[];
}

export class CreateAccessPlanDto {
  @IsString() name!: string;
  @IsIn(["DURATION", "FIXED_EXPIRY"]) accessType!: "DURATION" | "FIXED_EXPIRY";
  @IsInt() @Min(1) @IsOptional() durationMonths?: number;
  @IsString() @IsOptional() fixedExpiryDate?: string;
  @IsInt() @Min(0) priceMinor!: number;
  @IsBoolean() @IsOptional() explanationsEnabled?: boolean;
}

export class UpdateAccessPlanDto {
  @IsString() @IsOptional() name?: string;
  @IsInt() @Min(0) @IsOptional() priceMinor?: number;
  @IsBoolean() @IsOptional() explanationsEnabled?: boolean;
  @IsBoolean() @IsOptional() isActive?: boolean;
}

export class ManualCoursePurchaseDto {
  @IsUUID() @IsOptional() familyId?: string;
  @IsArray() @IsUUID("4", { each: true }) studentIds!: string[];
  @IsInt() @Min(0) amountMinor!: number;
  @IsIn(["CARD", "BANK_TRANSFER", "CASH", "OTHER"]) paymentMethod!: "CARD" | "BANK_TRANSFER" | "CASH" | "OTHER";
}

export class CreateTestDto {
  @IsString() title!: string;
  @IsIn(["MINI", "KNOWLEDGE_CHECK"]) type!: "MINI" | "KNOWLEDGE_CHECK";
  @IsInt() @Min(1) @IsOptional() timeLimitSeconds?: number;
  @IsInt() @Min(0) @Max(100) @IsOptional() lowScoreThresholdPercent?: number;
}

export class UpdateTestDto {
  @IsString() @IsOptional() title?: string;
  @IsInt() @Min(1) @IsOptional() timeLimitSeconds?: number;
  @IsInt() @Min(0) @Max(100) @IsOptional() lowScoreThresholdPercent?: number;
}

export class CreateQuestionDto {
  @IsIn(["STATIC", "GENERATED"]) type!: "STATIC" | "GENERATED";
  @IsUUID() @IsOptional() topicId?: string;
  @IsObject() promptTemplate!: Record<string, unknown>;
  @IsObject() answerDefinition!: Record<string, unknown>;
  @IsObject() @IsOptional() generatorDefinition?: Record<string, unknown>;
  @IsObject() @IsOptional() explanationContent?: Record<string, unknown>;
  @IsInt() @Min(1) position!: number;
  @IsInt() @Min(1) @IsOptional() points?: number;
}

export class CreateSubjectTopicDto {
  @IsUUID() subjectId!: string;
  @IsUUID() @IsOptional() parentTopicId?: string;
  @IsString() name!: string;
  @IsString() @IsOptional() code?: string;
}

export class SubmitAnswerDto {
  @IsDefined() answer!: unknown;
}

export class StartMistakePracticeDto {
  @IsUUID() @IsOptional() courseEnrollmentId?: string;
}

export class RequestTutorFromCourseDto {
  @IsUUID() @IsOptional() attemptId?: string;
  @IsUUID() @IsOptional() topicId?: string;
  @IsString() @IsOptional() note?: string;
}
