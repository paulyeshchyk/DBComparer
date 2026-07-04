export interface TypeNormalizer {
    normalizeType(dataType: string, maxLength?: number | null, precision?: number | null, scale?: number | null): string;
}