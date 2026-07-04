import { DatabaseType } from '../types';
import { TypeNormalizer } from './types';
import { MssqlNormalizer } from './mssql-normalizer';
import { PgsqlNormalizer } from './postgresql-normalizer';

export class NormalizerFactory {
    static getNormalizer(dbType: DatabaseType): TypeNormalizer | null {
        switch (dbType) {
            case DatabaseType.MsSql:
                return MssqlNormalizer;
            case DatabaseType.PostgreSql:
                return PgsqlNormalizer;
            default:
                return null;
        }
    }
}