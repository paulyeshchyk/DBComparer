// src/extractors/postgresql.ts

import { Client } from 'pg';
import { DatabaseMetadataExtractor } from './base';
import { DatabaseMetadata, TableInfo, IndexInfo, ProcedureInfo } from '../types';

export class PgMetadataExtractor extends DatabaseMetadataExtractor {
  private clientConfig: any;

  constructor(connectionString: string) {
    super(connectionString);
    this.clientConfig = this.parseConnectionString(connectionString);
  }
  private parseConnectionString(connStr: string) {
    // Поддержка разных форматов
    if (connStr.startsWith('postgresql://') || connStr.startsWith('postgres://')) {
      return { connectionString: connStr };
    }

    // Парсинг формата Key=Value;
    const config: any = {};
    const parts = connStr.split(';');

    for (const part of parts) {
      const [key, value] = part.split('=').map(s => s.trim());
      if (!key || !value) continue;

      const k = key.toLowerCase();
      if (k === 'host') config.host = value;
      else if (k === 'port') config.port = parseInt(value);
      else if (k === 'database' || k === 'dbname') config.database = value;
      else if (k === 'user id' || k === 'user') config.user = value;
      else if (k === 'password') config.password = value;
    }

    return config;
  }
  public async extractMetadataAsync(): Promise<DatabaseMetadata> {
    const metadata: DatabaseMetadata = {
      connectionString: this.connectionString,
      tables: [],
      procedures: []
    };

    metadata.tables = await this.extractTablesAsync();
    metadata.procedures = await this.extractProceduresAsync();

    return metadata;
  }

  private async extractProceduresAsync(): Promise<ProcedureInfo[]> {
    const client = new Client({ connectionString: this.connectionString });
    await client.connect();

    const query = `
      SELECT routine_schema, routine_name
      FROM information_schema.routines
      WHERE routine_type = 'PROCEDURE'
        AND routine_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY routine_schema, routine_name`;

    const result = await client.query(query);
    await client.end();

    return result.rows.map((row: any) => ({
      schema: row.routine_schema,
      name: row.routine_name
    }));
  }

  protected async extractTablesAsync(): Promise<TableInfo[]> {
    const tables: TableInfo[] = [];
    const client = new Client({ connectionString: this.connectionString });
    await client.connect();

    const tableQuery = `
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_type = 'BASE TABLE'
        AND table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY table_schema, table_name`;

    const tableResult = await client.query(tableQuery);

    for (const row of tableResult.rows) {
      const schema = row.table_schema;
      const tableName = row.table_name;

      const tableInfo: TableInfo = {
        schema,
        name: tableName,
        columns: [],
        indexes: []
      };

      // Columns
      const colQuery = `
        SELECT column_name, data_type, is_nullable,
               character_maximum_length, numeric_precision, numeric_scale
        FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position`;

      const colResult = await client.query(colQuery, [schema, tableName]);

      const pkColumns = await this.getPrimaryKeyColumns(client, schema, tableName);

      for (const col of colResult.rows) {
        const dataType = col.data_type;
        tableInfo.columns.push({
          name: col.column_name,
          dataType,
          isNullable: col.is_nullable === 'YES',
          isPrimaryKey: pkColumns.has(col.column_name)
        });
      }

      tableInfo.indexes = await this.getIndexes(client, schema, tableName);

      tables.push(tableInfo);
    }

    await client.end();
    return tables;
  }

  private async getPrimaryKeyColumns(client: Client, schema: string, tableName: string): Promise<Set<string>> {
    const pk = new Set<string>();
    const query = `
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu 
        ON tc.constraint_name = kcu.constraint_name
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema = $1
        AND tc.table_name = $2`;

    const result = await client.query(query, [schema, tableName]);
    for (const row of result.rows) {
      pk.add(row.column_name);
    }
    return pk;
  }

  private async getIndexes(client: Client, schema: string, tableName: string): Promise<IndexInfo[]> {
    const indexes: IndexInfo[] = [];

    const query = `
        SELECT 
            i_rel.relname AS index_name,
            i.indisunique AS is_unique,
            i.indisclustered AS is_clustered,
            am.amname AS index_type,
            string_agg(a.attname, ', ' ORDER BY array_position(i.indkey, a.attnum)) AS columns
        FROM pg_index i
        JOIN pg_class t ON i.indrelid = t.oid
        JOIN pg_namespace n ON t.relnamespace = n.oid
        JOIN pg_class i_rel ON i.indexrelid = i_rel.oid
        JOIN pg_am am ON i_rel.relam = am.oid
        LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(i.indkey)
        WHERE n.nspname = $1
          AND t.relname = $2
          AND i.indisprimary = false
        GROUP BY i_rel.relname, i.indisunique, i.indisclustered, am.amname
        ORDER BY i_rel.relname
    `;

    const result = await client.query(query, [schema, tableName]);

    for (const row of result.rows) {
      const columns = row.columns ? row.columns.split(',').map((c: string) => c.trim()) : [];
      indexes.push({
        name: row.index_name,
        columns: columns,
        isUnique: row.is_unique,
        isClustered: row.is_clustered || false,
        indexType: row.index_type
      });
    }

    return indexes;
  }
}