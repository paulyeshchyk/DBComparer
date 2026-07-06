// src/extractors/base.ts

import { Logger } from "../../webview/compare-panel";
import { DatabaseMetadata } from "../types";

export abstract class DatabaseMetadataExtractor {
    protected readonly connectionString: string;
    protected logger = Logger.getInstance();

    constructor(connectionString: string) {
        this.connectionString = connectionString;
    }

    abstract extractMetadataAsync(): Promise<DatabaseMetadata>;
}
