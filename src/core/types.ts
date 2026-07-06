// src/types.ts
export interface ICompareResult<TInfo, TDiff> {
    onlyInSource: TInfo[];
    onlyInTarget: TInfo[];
    common: TDiff[];
    caseDifferences: { schema: string; name: string; sourceName: string; targetName: string }[];
}

export interface IParameterInfo {
    name: string;
    dataType: string;
    isNullable: boolean;
    isOutput: boolean;
    maxLength?: number | null;
    precision?: number | null;
    scale?: number | null;
}

export interface IColumnInfo {
  name: string;
  dataType: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
}

export interface IIndexInfo {
  name: string;
  columns: string[];
  isUnique: boolean;
  isClustered: boolean;
  indexType?: string;
}

export interface IParameterDiff {
    onlyInSource: string[];
    onlyInTarget: string[];
    diff: { name: string; sourceType: string; targetType: string }[];
    caseDiff: { name: string; sourceName: string; targetName: string }[];
}

export interface IProcedureInfo {
    schema: string;
    name: string;
    parameters: IParameterInfo[];
}

export interface ITableInfo {
  schema: string;
  name: string;
  columns: IColumnInfo[];
  indexes: IIndexInfo[];
}

export interface DatabaseMetadata {
  connectionString: string;
  tables: ITableInfo[];
  procedures: IProcedureInfo[];
}

export enum DatabaseType {
  Unknown,
  MsSql,
  PostgreSql
}

export interface IConnectionConfig {
  source: { connectionString: string; name?: string };
  target: { connectionString: string; name?: string };
  options: {
    normalizeTypes: boolean;
    normalizeSchemaEnabled?: boolean;
    hideIdentical?: boolean;
    normalizeSchema?: Record<string, string>;
    ignoreCase?: boolean;
  };
}

// Diff-структуры
export interface IColumnDiff {
  onlyInSource: string[];
  onlyInTarget: string[];
  diff: { name: string; sourceType: string; targetType: string }[];
  caseDiff: { name: string; sourceName: string; targetName: string }[];
}

export interface IIndexDiff {
  onlyInSource: string[];
  onlyInTarget: string[];
  diff: { name: string; sourceDesc: string; targetDesc: string }[];
  caseDiff: { name: string; sourceName: string; targetName: string }[];
}

export interface ITableDiff {
  schema: string;
  name: string;
  columns: IColumnDiff;
  indexes: IIndexDiff;
}

export interface IProcedureDiff {
    schema: string;
    name: string;
    parameters: IParameterDiff; 
}

export interface IMetadataDiff {
    tables: ICompareResult<ITableInfo, ITableDiff>;
    procedures: ICompareResult<IProcedureInfo, IProcedureDiff>;
}

// Опции сравнения
export class CompareOptions {
  constructor(
    public ignoreCase: boolean,
    public hideIdentical: boolean
  ) {}
}

// Интерфейсы для менеджеров
export interface ICacheManager {
  getCacheDir(): string;
  getCachePath(hash: string): string;
  exportCache(targetDir: string, hash: string): string | null;
  computeHash(sourceConn: string, targetConn: string): string;
  saveCache(hash: string, data: any): void;
  loadCache(hash: string): any | null;
  deleteCacheFile(hash: string): void;
  getCacheList(): any[];
}

export interface IComparator {
  compareMetadata(source: DatabaseMetadata, target: DatabaseMetadata, options: CompareOptions): IMetadataDiff;
}