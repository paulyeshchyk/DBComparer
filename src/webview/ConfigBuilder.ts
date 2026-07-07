import { IConnectionConfig } from "../core/types";

export class ConfigBuilder {
    static build(rawConfig: any): IConnectionConfig {
        const sourceConn = rawConfig.source;
        const targetConn = rawConfig.target;
        const ignoreCase = rawConfig.ignoreCase ?? true;
        const normalizeTypes = rawConfig.normalizeTypes ?? true;
        const normalizeSchemaEnabled = rawConfig.normalizeSchemaEnabled ?? true;
        const normalizeSchema = rawConfig.normalizeSchema;
        const hideIdentical = rawConfig.hideIdentical ?? false;

        return {
            source: { connectionString: sourceConn },
            target: { connectionString: targetConn },
            options: {
                normalizeTypes,
                normalizeSchemaEnabled,
                normalizeSchema: normalizeSchema && Object.keys(normalizeSchema).length > 0 ? normalizeSchema : undefined,
                ignoreCase,
                hideIdentical,
                includeFilters: rawConfig.includeFilters || ["*"], // <--
                excludeFilters: rawConfig.excludeFilters || [], // <--
            },
        };
    }
}
