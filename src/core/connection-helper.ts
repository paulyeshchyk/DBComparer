// src/connection-helper.ts

import { DatabaseType } from './types';

export class ConnectionStringHelper {
  static getDatabaseType(connectionString: string): DatabaseType {
    if (!connectionString) return DatabaseType.Unknown;

    const lower = connectionString.toLowerCase();

    // MSSQL признаки
    if (lower.includes('server=') || lower.includes('data source=') || 
        lower.includes('trustservercertificate')) {
      return DatabaseType.MsSql;
    }

    // PostgreSQL признаки
    if (lower.includes('host=') && lower.includes('port=') || 
        lower.includes('postgresql://')) {
      return DatabaseType.PostgreSql;
    }

    return DatabaseType.Unknown;
  }
}