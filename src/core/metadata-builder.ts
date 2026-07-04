import { ConnectionConfig, DatabaseMetadata } from './types';
import { DatabaseMetadataExtractor } from './extractors/base';
import { ConnectionStringHelper } from './connection-helper';
import { NormalizerFactory } from './normalizers/factory';

export class MetadataBuilder {
  static async build(
        config: ConnectionConfig, 
        extractor: DatabaseMetadataExtractor
    ): Promise<DatabaseMetadata> {
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

  static normalizeSchema(config: ConnectionConfig, metadata: DatabaseMetadata) {
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
      table.columns.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      table.indexes.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    }
    metadata.tables.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    metadata.procedures.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }
}