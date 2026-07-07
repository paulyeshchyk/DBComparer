import { MetadataBuilder } from "../core/metadata-builder";
import { DatabaseMetadata, IConnectionConfig } from "../core/types";

export class MetadataAdapter {
    public static adapt(sourceRaw: DatabaseMetadata, config: IConnectionConfig) {
        const sourceMeta = JSON.parse(JSON.stringify(sourceRaw));

        if (config.options.normalizeTypes) {
            MetadataBuilder.normalizeTypes(sourceMeta);
        }
        if (config.options.normalizeSchemaEnabled) {
            MetadataBuilder.normalizeSchema(config, sourceMeta);
        }
        // Применяем фильтры (используя уже нормализованные схемы)
        const include = config.options.includeFilters?.filter((i) => i !== "*") ?? ["*"];
        const exclude = config.options.excludeFilters ?? [];
        const filtered = MetadataBuilder.applyFilters(sourceMeta, include, exclude);
        // Сортируем после фильтрации
        MetadataBuilder.resort(filtered);
        return filtered;
    }
}
