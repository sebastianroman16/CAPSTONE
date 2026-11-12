import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Pool, QueryResultRow } from "pg";
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly pool = new Pool({ connectionString: process.env.DATABASE_URL });
  query<T extends QueryResultRow = any>(text: string, values: unknown[] = []) {
    return this.pool.query<T>(text, values);
  }
  async onModuleDestroy() {
    await this.pool.end();
  }
}
