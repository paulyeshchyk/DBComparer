// src/extractors/base.ts

import { DatabaseMetadata } from "../types";


export abstract class DatabaseMetadataExtractor {
  protected readonly connectionString: string;

  constructor(connectionString: string) {
    this.connectionString = connectionString;
  }

  abstract extractMetadataAsync(): Promise<DatabaseMetadata>;
  protected abstract extractTablesAsync(): Promise<any[]>; // будет переопределено
}