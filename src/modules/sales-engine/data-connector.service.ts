import { BadRequestException, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { createLogger } from '../../common/services/logger.service';
import { LeadSource } from './entities/sales.entities';

export interface ConnectorLead {
  name?: string;
  phone?: string;
  attributes: Record<string, unknown>;
}

/** Tipo mínimo do pool do `pg` (driver sem @types). */
interface PgPool {
  query: (sql: string) => Promise<{ rows: Record<string, unknown>[] }>;
  end: () => Promise<void>;
}

interface PgConfig {
  host: string;
  port?: number;
  database: string;
  user: string;
  password: string;
  query: string;
  nameColumn?: string;
  phoneColumn?: string;
  ssl?: boolean;
}

/**
 * Item 1 — Conector de bases tradicionais (read-only).
 * Suporta Postgres (driver `pg`) e leads inline. A query é validada para ser apenas leitura.
 * (MySQL/SQL Server: adicionar o driver e um branch análogo.)
 */
@Injectable()
export class DataConnectorService {
  private readonly logger = createLogger('DataConnectorService');

  private assertReadOnly(query: string): void {
    const q = query.trim().toLowerCase();
    if (!q.startsWith('select') && !q.startsWith('with')) {
      throw new BadRequestException('A query da fonte deve ser somente leitura (começar com SELECT/WITH).');
    }
    if (/\b(insert|update|delete|drop|alter|truncate|create|grant|revoke)\b/.test(q)) {
      throw new BadRequestException('A query contém comandos de escrita — não permitido (fonte read-only).');
    }
  }

  private async withPool<T>(cfg: PgConfig, fn: (pool: PgPool) => Promise<T>): Promise<T> {
    const pool = new Pool({
      host: cfg.host,
      port: cfg.port ?? 5432,
      database: cfg.database,
      user: cfg.user,
      password: cfg.password,
      max: 2,
      connectionTimeoutMillis: 8000,
      ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
    }) as PgPool;
    try {
      return await fn(pool);
    } finally {
      await pool.end().catch(() => undefined);
    }
  }

  async testConnection(source: LeadSource): Promise<{ ok: boolean; message: string }> {
    if (source.type === 'inline') {
      const leads = (source.config?.leads as unknown[]) ?? [];
      return { ok: true, message: `Fonte inline com ${leads.length} lead(s).` };
    }
    const cfg = source.config as unknown as PgConfig;
    try {
      await this.withPool(cfg, async pool => {
        await pool.query('SELECT 1');
      });
      return { ok: true, message: 'Conexão Postgres OK.' };
    } catch (err) {
      return { ok: false, message: String(err instanceof Error ? err.message : err) };
    }
  }

  async fetchLeads(source: LeadSource, limit = 50): Promise<ConnectorLead[]> {
    if (source.type === 'inline') {
      const leads = ((source.config?.leads as ConnectorLead[]) ?? []).slice(0, limit);
      return leads.map(l => ({ name: l.name, phone: l.phone, attributes: l.attributes ?? {} }));
    }

    const cfg = source.config as unknown as PgConfig;
    this.assertReadOnly(cfg.query);
    const nameCol = cfg.nameColumn;
    const phoneCol = cfg.phoneColumn;

    return this.withPool(cfg, async pool => {
      // Envolve a query do operador como subconsulta e aplica LIMIT externo (read-only).
      const sql = `SELECT * FROM (${cfg.query}) AS _src LIMIT ${Math.max(1, Math.min(limit, 500))}`;
      const result = await pool.query(sql);
      return result.rows.map((row: Record<string, unknown>) => {
        const attributes = { ...row };
        const name = nameCol ? String(row[nameCol] ?? '') : undefined;
        const phone = phoneCol ? String(row[phoneCol] ?? '') : undefined;
        return { name: name || undefined, phone: phone || undefined, attributes };
      });
    });
  }
}
