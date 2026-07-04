// src/normalizers/postgresql-normalizer.ts
import { TypeNormalizer } from './types';

export const PgsqlNormalizer: TypeNormalizer = {
    normalizeType(dataType: string, maxLength?: number | null, precision?: number | null, scale?: number | null): string {
        const type = dataType.toLowerCase().trim();

        if (type === 'smallint') return 'word';
        if (type === 'integer') return 'dword';
        if (type === 'bigint') return 'qword';
        if (type === 'boolean') return 'bool';
        if (type === 'uuid') return 'guid';
        if (type === 'real') return 'float';
        if (type === 'double precision') return 'double';
        if (['numeric', 'decimal'].includes(type)) {
            if (precision != null && scale != null) return `decimal(${precision},${scale})`;
            if (precision != null) return `decimal(${precision})`;
            return 'decimal';
        }
        if (['character varying', 'varchar'].includes(type)) {
            if (maxLength && maxLength > 0) return `string(${maxLength})`;
            return 'string(MAX)';
        }
        if (['character', 'char'].includes(type)) {
            if (maxLength && maxLength > 0) return `fixedstring(${maxLength})`;
            return 'fixedstring';
        }
        if (type === 'text') return 'string(MAX)';
        if (type === 'date') return 'date';
        if (['time', 'time without time zone'].includes(type)) return 'time';
        if (['timestamp', 'timestamp without time zone', 'timestamptz'].includes(type)) return 'datetime';
        if (type === 'bytea') return 'binary(MAX)';
        return dataType;
    }
};