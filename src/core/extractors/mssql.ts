// src/extractors/mssql.ts

import * as sql from 'mssql';
import { DatabaseMetadataExtractor } from './base';
import { DatabaseMetadata, TableInfo, IndexInfo, ProcedureInfo } from '../types';

export class MssqlMetadataExtractor extends DatabaseMetadataExtractor {
  constructor(connectionString: string) {
    super(connectionString);
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
    const procedures: ProcedureInfo[] = [];
    const pool = await sql.connect(this.connectionString);

    const query = `
      SELECT ROUTINE_SCHEMA, ROUTINE_NAME
      FROM INFORMATION_SCHEMA.ROUTINES
      WHERE ROUTINE_TYPE = 'PROCEDURE'
        AND ROUTINE_SCHEMA NOT IN ('sys', 'INFORMATION_SCHEMA')
      ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME`;

    const result = await pool.request().query(query);

    for (const row of result.recordset) {
      procedures.push({
        schema: row.ROUTINE_SCHEMA,
        name: row.ROUTINE_NAME
      });
    }

    await pool.close();
    return procedures;
  }

  protected async extractTablesAsync(): Promise<TableInfo[]> {
    const tables: TableInfo[] = [];
    const pool = await sql.connect(this.connectionString);

    const tableQuery = `
      SELECT TABLE_SCHEMA, TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE = 'BASE TABLE'
        AND TABLE_SCHEMA NOT IN ('sys', 'INFORMATION_SCHEMA')
      ORDER BY TABLE_SCHEMA, TABLE_NAME`;

    const tableResult = await pool.request().query(tableQuery);
    const tableList = tableResult.recordset.map((r: any) => ({
      schema: r.TABLE_SCHEMA,
      name: r.TABLE_NAME
    }));

    for (const { schema, name: tableName } of tableList) {
      const tableInfo: TableInfo = {
        schema,
        name: tableName,
        columns: [],
        indexes: []
      };

      // Columns
      const colQuery = `
        SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE,
               CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @tableName
        ORDER BY ORDINAL_POSITION`;

      const colRequest = pool.request();
      colRequest.input('schema', sql.VarChar, schema);
      colRequest.input('tableName', sql.VarChar, tableName);

      const colResult = await colRequest.query(colQuery);
      const pkColumns = await this.getPrimaryKeyColumns(pool, schema, tableName);

      for (const col of colResult.recordset) {
        const formattedType = col.DATA_TYPE;

        tableInfo.columns.push({
          name: col.COLUMN_NAME,
          dataType: formattedType,
          isNullable: col.IS_NULLABLE === 'YES',
          isPrimaryKey: pkColumns.has(col.COLUMN_NAME)
        });
      }

      tableInfo.indexes = await this.getIndexes(pool, schema, tableName);
      tables.push(tableInfo);
    }

    await pool.close();
    return tables;
  }

  private async getPrimaryKeyColumns(pool: sql.ConnectionPool, schema: string, tableName: string): Promise<Set<string>> {
    const pk = new Set<string>();
    const query = `
      SELECT kcu.COLUMN_NAME
      FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
      JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu 
        ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
      WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
        AND tc.TABLE_SCHEMA = @schema
        AND tc.TABLE_NAME = @tableName`;

    const req = pool.request();
    req.input('schema', sql.VarChar, schema);
    req.input('tableName', sql.VarChar, tableName);

    const result = await req.query(query);
    for (const row of result.recordset) {
      pk.add(row.COLUMN_NAME);
    }
    return pk;
  }

  private async getIndexes(pool: sql.ConnectionPool, schema: string, tableName: string): Promise<IndexInfo[]> {
    const indexes: IndexInfo[] = [];

    // Запрос для получения индексов с колонками
    // Используем FOR XML PATH для совместимости с SQL Server 2008 и выше
    const query = `
        SELECT 
            i.name AS index_name,
            i.is_unique,
            i.is_primary_key,
            i.type_desc,
            STUFF((
                SELECT ', ' + c.name
                FROM sys.index_columns ic
                INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
                WHERE ic.object_id = i.object_id 
                  AND ic.index_id = i.index_id
                ORDER BY ic.key_ordinal
                FOR XML PATH('')
            ), 1, 2, '') AS columns
        FROM sys.indexes i
        INNER JOIN sys.tables t ON i.object_id = t.object_id
        INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
        WHERE s.name = @schema 
          AND t.name = @tableName
          AND i.name IS NOT NULL  -- Исключаем первичные ключи (их мы уже показываем отдельно)
          AND i.is_primary_key = 0
        ORDER BY i.name
    `;

    const request = pool.request();
    request.input('schema', sql.VarChar, schema);
    request.input('tableName', sql.VarChar, tableName);

    const result = await request.query(query);

    for (const row of result.recordset) {
      const columns = row.columns ? row.columns.split(',').map((c: string) => c.trim()) : [];
      indexes.push({
        name: row.index_name,
        columns: columns,
        isUnique: row.is_unique === true,
        isClustered: row.type_desc === 'CLUSTERED',
        indexType: row.type_desc
      });
    }

    return indexes;
  }
}