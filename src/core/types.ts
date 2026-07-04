// src/types.ts

export interface ColumnInfo {
  name: string;
  dataType: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  isUnique: boolean;
  isClustered: boolean;
  indexType?: string;
}

export interface ProcedureInfo {
  schema: string;
  name: string;
}

export interface TableInfo {
  schema: string;
  name: string;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
}

export interface DatabaseMetadata {
  connectionString: string; // только для отладки, не сохраняем
  tables: TableInfo[];
  procedures: ProcedureInfo[];
}

export enum DatabaseType {
  Unknown,
  MsSql,
  PostgreSql
}

export interface ConnectionConfig {
  source: { connectionString: string; name?: string };
  target: { connectionString: string; name?: string };
  options: {
    normalizeTypes: boolean;
    normalizeSchemaEnabled?: boolean;
    normalizeSchema?: Record<string, string>;
    ignoreCase?: boolean;
  };
}