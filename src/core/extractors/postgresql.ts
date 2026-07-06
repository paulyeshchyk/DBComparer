// src/extractors/postgresql.ts

import { Client } from "pg";
import { DatabaseMetadata, IIndexInfo, IProcedureInfo, ITableInfo } from "../types";
import { DatabaseMetadataExtractor } from "./base";

export class PgMetadataExtractor extends DatabaseMetadataExtractor {
    private clientConfig: any;

    constructor(connectionString: string) {
        super(connectionString);
        this.clientConfig = this.parseConnectionString(connectionString);
    }

    private parseConnectionString(connStr: string) {
        if (connStr.startsWith("postgresql://") || connStr.startsWith("postgres://")) {
            return { connectionString: connStr };
        }
        const config: any = {};
        const parts = connStr.split(";");
        for (const part of parts) {
            const [key, value] = part.split("=").map((s) => s.trim());
            if (!key || !value) continue;
            const k = key.toLowerCase();
            if (k === "host") config.host = value;
            else if (k === "port") config.port = parseInt(value);
            else if (k === "database" || k === "dbname") config.database = value;
            else if (k === "user id" || k === "user") config.user = value;
            else if (k === "password") config.password = value;
        }
        return config;
    }

    public async extractMetadataAsync(): Promise<DatabaseMetadata> {
        const client = new Client({ connectionString: this.connectionString });
        await client.connect();
        try {
            const tables = await this.extractTablesOptimized(client);
            const procedures = await this.extractProceduresOptimized(client);
            return {
                connectionString: this.connectionString,
                tables,
                procedures,
            };
        } finally {
            await client.end();
        }
    }

    // ---------- ОПТИМИЗИРОВАННОЕ ИЗВЛЕЧЕНИЕ ТАБЛИЦ ----------
    private async extractTablesOptimized(client: Client): Promise<ITableInfo[]> {
        this.logger.log(`pgsql: extracting tables (optimized)`);

        // 1. Получаем список всех таблиц
        const tableQuery = `
            SELECT table_schema, table_name
            FROM information_schema.tables
            WHERE table_type = 'BASE TABLE'
              AND table_schema NOT IN ('pg_catalog', 'information_schema')
            ORDER BY table_schema, table_name
        `;
        const tableResult = await client.query(tableQuery);
        const tableList = tableResult.rows.map((r: any) => ({
            schema: r.table_schema,
            name: r.table_name,
        }));

        if (tableList.length === 0) {
            return [];
        }

        // 2. Получаем все колонки для всех таблиц одним запросом
        const columnsQuery = `
            SELECT table_schema, table_name, column_name, data_type, is_nullable,
                   character_maximum_length, numeric_precision, numeric_scale
            FROM information_schema.columns
            WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
            ORDER BY table_schema, table_name, ordinal_position
        `;
        const columnsResult = await client.query(columnsQuery);
        const columnsMap = new Map<string, any[]>();
        for (const col of columnsResult.rows) {
            const key = `${col.table_schema}.${col.table_name}`;
            if (!columnsMap.has(key)) columnsMap.set(key, []);
            columnsMap.get(key)!.push(col);
        }

        // 3. Получаем все первичные ключи для всех таблиц одним запросом
        const pkQuery = `
            SELECT 
                tc.table_schema, 
                tc.table_name, 
                kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu 
                ON tc.constraint_name = kcu.constraint_name
            WHERE tc.constraint_type = 'PRIMARY KEY'
              AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')
        `;
        const pkResult = await client.query(pkQuery);
        const pkMap = new Map<string, Set<string>>();
        for (const row of pkResult.rows) {
            const key = `${row.table_schema}.${row.table_name}`;
            if (!pkMap.has(key)) pkMap.set(key, new Set());
            pkMap.get(key)!.add(row.column_name);
        }

        // 4. Получаем все индексы для всех таблиц одним запросом
        const indexesMap = await buildIndexMap(client);

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
                columns: cols.map((col: any) => ({
                    name: col.column_name,
                    dataType: col.data_type,
                    isNullable: col.is_nullable === "YES",
                    isPrimaryKey: pkSet.has(col.column_name),
                })),
                indexes: indexes,
            };
            tables.push(tableInfo);
        }

        this.logger.log(`pgsql: extracted ${tables.length} tables`);
        return tables;
    }

    // ---------- ОПТИМИЗИРОВАННОЕ ИЗВЛЕЧЕНИЕ ПРОЦЕДУР ----------
    private async extractProceduresOptimized(client: Client): Promise<IProcedureInfo[]> {
        this.logger.log(`pgsql: extracting procedures (optimized)`);

        const query = `
        SELECT 
            r.routine_schema,
            r.routine_name,
            p.parameter_name,
            p.data_type,
            p.parameter_mode,
            p.ordinal_position
        FROM information_schema.routines r
        LEFT JOIN information_schema.parameters p 
            ON p.specific_schema = r.specific_schema 
            AND p.specific_name = r.specific_name
        WHERE r.routine_type = 'PROCEDURE'
          AND r.routine_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY r.routine_schema, r.routine_name, p.ordinal_position
    `;
        const result = await client.query(query);

        const procMap = new Map<string, IProcedureInfo>();
        for (const row of result.rows) {
            const key = `${row.routine_schema}.${row.routine_name}`;
            if (!procMap.has(key)) {
                procMap.set(key, {
                    schema: row.routine_schema,
                    name: row.routine_name,
                    parameters: [],
                });
            }
            const proc = procMap.get(key)!;
            if (row.parameter_name) {
                proc.parameters.push({
                    name: row.parameter_name,
                    dataType: row.data_type || "unknown",
                    isNullable: true, // в PostgreSQL nullability обычно не задаётся в процедурах
                    isOutput: row.parameter_mode === "OUT" || row.parameter_mode === "INOUT",
                    maxLength: null,
                    precision: null,
                    scale: null,
                });
            }
        }

        const procedures = Array.from(procMap.values());
        this.logger.log(`pgsql: extracted ${procedures.length} procedures`);
        return procedures;
    }
}

async function buildIndexMap(client: Client) {
    try {
        const indexesQuery = `
            SELECT 
                n.nspname AS schema_name,
                t.relname AS table_name,
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
            WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
              AND i.indisprimary = false
            GROUP BY n.nspname, t.relname, i_rel.relname, i.indisunique, i.indisclustered, am.amname
            ORDER BY n.nspname, t.relname, i_rel.relname
        `;
        const indexesResult = await client.query(indexesQuery);
        const indexesMap = new Map<string, IIndexInfo[]>();
        for (const row of indexesResult.rows) {
            const key = `${row.schema_name}.${row.table_name}`;
            if (!indexesMap.has(key)) indexesMap.set(key, []);
            const columns = row.columns ? row.columns.split(",").map((c: string) => c.trim()) : [];
            indexesMap.get(key)!.push({
                name: row.index_name,
                columns: columns,
                isUnique: row.is_unique,
                isClustered: row.is_clustered || false,
                indexType: row.index_type,
            });
        }
        return indexesMap;
    } catch {
        return new Map<string, IIndexInfo[]>();
    }
}
