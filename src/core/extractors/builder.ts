// src/extractors/builder.ts

import { DatabaseMetadataExtractor } from './base';
import { MssqlMetadataExtractor } from './mssql';
import { PgMetadataExtractor } from './postgresql';
import { DatabaseType } from '../types';
import { ConnectionStringHelper } from '../connection-helper';

export class ExtractorBuilder {
  static createExtractor(connectionString: string): DatabaseMetadataExtractor | null {
    const type = ConnectionStringHelper.getDatabaseType(connectionString);

    switch (type) {
      case DatabaseType.MsSql:
        return new MssqlMetadataExtractor(connectionString);
      case DatabaseType.PostgreSql:
        return new PgMetadataExtractor(connectionString);
      default:
        return null;
    }
  }
}