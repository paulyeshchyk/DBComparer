// src/normalizers/mssql-normalizer.ts
import { TypeNormalizer } from './types';

export const MssqlNormalizer: TypeNormalizer = {
    normalizeType(dataType: string, maxLength?: number | null, precision?: number | null, scale?: number | null): string {
        const type = dataType.toLowerCase();

        if (['tinyint', 'smallint'].includes(type)) return 'word';
        if (type === 'int') return 'dword';
        if (type === 'bigint') return 'qword';
        if (type === 'bit') return 'bool';
        if (type === 'uniqueidentifier') return 'guid';
        if (['float', 'real'].includes(type)) return 'float';
        if (type === 'double') return 'double';
        if (['decimal', 'numeric'].includes(type)) {
            if (precision != null && scale != null) return `decimal(${precision},${scale})`;
            if (precision != null) return `decimal(${precision})`;
            return 'decimal';
        }
        if (['varchar', 'nvarchar'].includes(type)) {
            if (maxLength === -1) return 'string(MAX)';
            if (maxLength && maxLength > 0) return `string(${maxLength})`;
            return 'string(MAX)';
        }
        if (['char', 'nchar'].includes(type)) {
            if (maxLength && maxLength > 0) return `fixedstring(${maxLength})`;
            return 'fixedstring';
        }
        if (['text', 'ntext'].includes(type)) return 'string(MAX)';
        if (type === 'date') return 'date';
        if (type === 'time') return 'time';
        if (['datetime', 'datetime2', 'smalldatetime'].includes(type)) return 'datetime';
        if (['binary', 'varbinary'].includes(type)) {
            if (maxLength === -1) return 'binary(MAX)';
            if (maxLength && maxLength > 0) return `binary(${maxLength})`;
            return 'binary(MAX)';
        }
        return dataType;
    }
};