import { ConnectionStringHelper } from "./connection-helper";
import { DatabaseMetadataExtractor } from "./extractors/base";
import { NormalizerFactory } from "./normalizers/factory";
import { DatabaseMetadata, IConnectionConfig } from "./types";

export class MetadataBuilder {
    static async build(config: IConnectionConfig, extractor: DatabaseMetadataExtractor): Promise<DatabaseMetadata> {
        const metadata = await extractor.extractMetadataAsync();
        if (config.options.normalizeTypes) {
            this.normalizeTypes(metadata);
        }
        this.normalizeSchema(config, metadata);
        this.resort(metadata);
        return metadata;
    }

    static normalizeTypes(metadata: DatabaseMetadata) {
        const dbType = ConnectionStringHelper.getDatabaseType(metadata.connectionString);
        const normalizer = NormalizerFactory.getNormalizer(dbType);
        if (!normalizer) return;
        for (const table of metadata.tables) {
            for (const col of table.columns) {
                // Для сырых типов у нас нет информации о длине/точности, поэтому передаём null
                col.dataType = normalizer.normalizeType(col.dataType, null, null, null);
            }
        }
    }

    static normalizeSchema(config: IConnectionConfig, metadata: DatabaseMetadata) {
        if (!config.options.normalizeSchemaEnabled) return;
        const mapping = config.options.normalizeSchema || {};
        if (Object.keys(mapping).length === 0) return;

        for (const table of metadata.tables) {
            if (mapping[table.schema]) table.schema = mapping[table.schema];
        }
        for (const proc of metadata.procedures) {
            if (mapping[proc.schema]) proc.schema = mapping[proc.schema];
        }
    }

    static normalizeName(schema: string, name: string, ignoreCase: boolean): string {
        return ignoreCase ? `${schema.toLowerCase()}.${name.toLowerCase()}` : `${schema}.${name}`;
    }

    static resort(metadata: DatabaseMetadata) {
        for (const table of metadata.tables) {
            table.columns.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
            table.indexes.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
        }
        metadata.tables.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
        metadata.procedures.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    }

    static applyFilters(metadata: DatabaseMetadata, includeFilters: string[], excludeFilters: string[]): DatabaseMetadata {
        const filterObjects = <T extends { schema: string; name: string }>(objects: T[], include: string[], exclude: string[]): T[] => {
            const hasInclude = include && include.length > 0 && !(include.length === 1 && include[0] === "*");
            const includeRegexes = hasInclude ? include.map((f) => new RegExp(f, "i")) : null;
            const excludeRegexes = exclude && exclude.length > 0 ? exclude.map((f) => new RegExp(f, "i")) : [];

            return objects.filter((obj) => {
                const fullName = `${obj.schema}.${obj.name}`;
                if (includeRegexes) {
                    const matched = includeRegexes.some((re) => re.test(fullName));
                    if (!matched) return false;
                }
                if (excludeRegexes.length > 0) {
                    const excluded = excludeRegexes.some((re) => re.test(fullName));
                    if (excluded) return false;
                }
                return true;
            });
        };

        return {
            provider: metadata.provider,
            connectionString: metadata.connectionString,
            tables: filterObjects(metadata.tables, includeFilters, excludeFilters),
            procedures: filterObjects(metadata.procedures, includeFilters, excludeFilters),
        };
    }

    private static filterObjects<T>(objects: T[], includeFilters: string[], excludeFilters: string[], getName: (obj: T) => string): T[] {
        // Если includeFilters содержит только "*" или пусто, то все включены
        const hasIncludeFilters = includeFilters && includeFilters.length > 0 && !(includeFilters.length === 1 && includeFilters[0] === "*");
        const includeRegexes = hasIncludeFilters ? includeFilters.map((f) => new RegExp(f, "i")) : null;
        const excludeRegexes = excludeFilters && excludeFilters.length > 0 ? excludeFilters.map((f) => new RegExp(f, "i")) : [];

        return objects.filter((obj) => {
            const name = getName(obj);
            // Включающие фильтры (OR)
            if (includeRegexes) {
                const matched = includeRegexes.some((re) => re.test(name));
                if (!matched) return false;
            }
            // Исключающие фильтры (OR)
            if (excludeRegexes.length > 0) {
                const excluded = excludeRegexes.some((re) => re.test(name));
                if (excluded) return false;
            }
            return true;
        });
    }
}
