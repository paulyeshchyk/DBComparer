// src/extractors/mssql.ts

import * as sql from "mssql";
import { DatabaseMetadata, IIndexInfo, IProcedureInfo, ITableInfo } from "../types";
import { DatabaseMetadataExtractor } from "./base";

export class MssqlMetadataExtractor extends DatabaseMetadataExtractor {
    constructor(connectionString: string) {
        super(connectionString);
    }

    public async extractMetadataAsync(): Promise<DatabaseMetadata> {
        const pool = await sql.connect(this.connectionString);
        try {
            const tables = await this.extractTablesOptimized(pool);
            const procedures = await this.extractProceduresOptimized(pool);
            return {
                provider: "mssql",
                connectionString: this.connectionString,
                tables,
                procedures,
            };
        } finally {
            await pool.close();
        }
    }

    // ---------- ОПТИМИЗИРОВАННОЕ ИЗВЛЕЧЕНИЕ ТАБЛИЦ ----------
    private async extractTablesOptimized(pool: sql.ConnectionPool): Promise<ITableInfo[]> {
        this.logger.log(`mssql: extracting tables (optimized)`);

        // 1. Получаем список всех таблиц
        const tableQuery = `
            SELECT TABLE_SCHEMA, TABLE_NAME
            FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_TYPE = 'BASE TABLE'
              AND TABLE_SCHEMA NOT IN ('sys', 'INFORMATION_SCHEMA')
            ORDER BY TABLE_SCHEMA, TABLE_NAME
        `;
        const tableResult = await pool.request().query(tableQuery);
        const tableList = tableResult.recordset.map((r: any) => ({
            schema: r.TABLE_SCHEMA,
            name: r.TABLE_NAME,
        }));

        if (tableList.length === 0) {
            return [];
        }

        // 2. Получаем все колонки для всех таблиц одним запросом
        const columnsQuery = `
            SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE,
                   CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA NOT IN ('sys', 'INFORMATION_SCHEMA')
            ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION
        `;
        const columnsResult = await pool.request().query(columnsQuery);
        const columnsMap = new Map<string, any[]>();
        for (const col of columnsResult.recordset) {
            const key = `${col.TABLE_SCHEMA}.${col.TABLE_NAME}`;
            if (!columnsMap.has(key)) columnsMap.set(key, []);
            columnsMap.get(key)!.push(col);
        }

        // 3. Получаем все первичные ключи для всех таблиц одним запросом
        const pkQuery = `
            SELECT 
                tc.TABLE_SCHEMA, 
                tc.TABLE_NAME, 
                kcu.COLUMN_NAME
            FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
            JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu 
                ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
            WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
              AND tc.TABLE_SCHEMA NOT IN ('sys', 'INFORMATION_SCHEMA')
        `;
        const pkResult = await pool.request().query(pkQuery);
        const pkMap = new Map<string, Set<string>>();
        for (const row of pkResult.recordset) {
            const key = `${row.TABLE_SCHEMA}.${row.TABLE_NAME}`;
            if (!pkMap.has(key)) pkMap.set(key, new Set());
            pkMap.get(key)!.add(row.COLUMN_NAME);
        }

        // 4. Получаем все индексы для всех таблиц одним запросом
        const indexesQuery = `
            SELECT 
                s.name AS schema_name,
                t.name AS table_name,
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
            WHERE s.name NOT IN ('sys', 'INFORMATION_SCHEMA')
              AND i.name IS NOT NULL
              AND i.is_primary_key = 0
            ORDER BY s.name, t.name, i.name
        `;
        const indexesResult = await pool.request().query(indexesQuery);
        const indexesMap = new Map<string, IIndexInfo[]>();
        for (const row of indexesResult.recordset) {
            const key = `${row.schema_name}.${row.table_name}`;
            if (!indexesMap.has(key)) indexesMap.set(key, []);
            const columns = row.columns ? row.columns.split(",").map((c: string) => c.trim()) : [];
            indexesMap.get(key)!.push({
                name: row.index_name,
                columns: columns,
                isUnique: row.is_unique === true,
                isClustered: row.type_desc === "CLUSTERED",
                indexType: row.type_desc,
            });
        }

        // 5. Собираем таблицы из полученных данных
        const tables: ITableInfo[] = [];
        for (const { schema, name } of tableList) {
            const key = `${schema}.${name}`;
            const cols = columnsMap.get(key) || [];
            const pkSet = pkMap.get(key) || new Set<string>();
            const indexes = indexesMap.get(key) || [];

            const tableInfo: ITableInfo = {
                schema,
                name,
                provider: "mssql",
                columns: cols.map((col: any) => ({
                    name: col.COLUMN_NAME,
                    dataType: col.DATA_TYPE,
                    isNullable: col.IS_NULLABLE === "YES",
                    isPrimaryKey: pkSet.has(col.COLUMN_NAME),
                })),
                indexes: indexes,
            };
            tables.push(tableInfo);
        }

        this.logger.log(`mssql: extracted ${tables.length} tables`);
        return tables;
    }

    // ---------- ОПТИМИЗИРОВАННОЕ ИЗВЛЕЧЕНИЕ ПРОЦЕДУР ----------
    private async extractProceduresOptimized(pool: sql.ConnectionPool): Promise<IProcedureInfo[]> {
        this.logger.log(`mssql: extracting procedures (optimized)`);

        // Получаем все процедуры и их параметры одним запросом
        const query = `
            SELECT 
                s.name AS schema_name,
                pr.name AS proc_name,
                p.name AS param_name,
                TYPE_NAME(p.user_type_id) AS param_type,
                p.is_nullable,
                p.is_output,
                p.max_length,
                p.precision,
                p.scale,
                p.parameter_id
            FROM sys.procedures pr
            INNER JOIN sys.schemas s ON pr.schema_id = s.schema_id
            LEFT JOIN sys.parameters p ON p.object_id = pr.object_id
            WHERE s.name NOT IN ('sys', 'INFORMATION_SCHEMA')
            ORDER BY s.name, pr.name, p.parameter_id
        `;
        const result = await pool.request().query(query);

        // Группируем параметры по процедуре
        const procMap = new Map<string, IProcedureInfo>();
        for (const row of result.recordset) {
            const key = `${row.schema_name}.${row.proc_name}`;
            if (!procMap.has(key)) {
                procMap.set(key, {
                    schema: row.schema_name,
                    name: row.proc_name,
                    provider: "mssql",
                    parameters: [],
                });
            }
            const proc = procMap.get(key)!;
            if (row.param_name) {
                proc.parameters.push({
                    name: row.param_name,
                    dataType: row.param_type,
                    isNullable: row.is_nullable === 1,
                    isOutput: row.is_output === 1,
                    maxLength: row.max_length === -1 ? null : row.max_length,
                    precision: row.precision,
                    scale: row.scale,
                });
            }
        }

        const procedures = Array.from(procMap.values());
        this.logger.log(`mssql: extracted ${procedures.length} procedures`);
        return procedures;
    }
}
