import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createDatabase } from "@school/db";
import { DATABASE, DATABASE_CONNECTION, DATABASE_POOL } from "./database.constants";
import { DatabaseLifecycleService } from "./database-lifecycle.service";

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_CONNECTION,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>("DATABASE_URL");
        if (!url) throw new Error("DATABASE_URL is required");
        return createDatabase(url);
      },
    },
    {
      provide: DATABASE,
      inject: [DATABASE_CONNECTION],
      useFactory: (connection: ReturnType<typeof createDatabase>) => connection.db,
    },
    {
      provide: DATABASE_POOL,
      inject: [DATABASE_CONNECTION],
      useFactory: (connection: ReturnType<typeof createDatabase>) => connection.pool,
    },
    DatabaseLifecycleService,
  ],
  exports: [DATABASE, DATABASE_POOL],
})
export class DatabaseModule {}
