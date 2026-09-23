import { Global, Module } from "@nestjs/common";
import { ErrorReporter } from "./error-reporter.service";
import { JsonLogger } from "./json-logger.service";
import { MetricsController } from "./metrics.controller";
import { MetricsService } from "./metrics.service";

@Global()
@Module({
  controllers: [MetricsController],
  providers: [JsonLogger, MetricsService, ErrorReporter],
  exports: [JsonLogger, MetricsService, ErrorReporter],
})
export class ObservabilityModule {}
