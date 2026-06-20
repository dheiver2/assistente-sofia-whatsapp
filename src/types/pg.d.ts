// O driver `pg` não embarca tipos e o projeto não instala @types/pg.
// Declaração mínima e tipada para o conector de bases do Motor de Vendas (uso read-only).
declare module 'pg' {
  export interface PgQueryResult {
    rows: Record<string, unknown>[];
  }
  export class Pool {
    constructor(config?: Record<string, unknown>);
    query(sql: string): Promise<PgQueryResult>;
    end(): Promise<void>;
  }
}
