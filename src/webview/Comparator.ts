import { CompareOptions, DatabaseMetadata, IComparator, IMetadataDiff } from "../core/types";
import { MetadataDiffResult } from "./compare-panel";
import { Logger } from "./Logger";
import { ProcedureComparator } from "./ProcedureComparator";
import { TableComparator } from "./TableComparator";

export class Comparator implements IComparator {
    private tableComparator = new TableComparator();
    private procComparator = new ProcedureComparator();
    private logger = Logger.getInstance();

    compareMetadata(source: DatabaseMetadata, target: DatabaseMetadata, options: CompareOptions): IMetadataDiff {
        this.logger.log(`Compare - ignore case:${options.ignoreCase}; hideIdentical:${options.hideIdentical}; source:${source.connectionString}; target:${target.connectionString}`);

        const tablesResult = this.tableComparator.compareTables(source.tables, target.tables, options);
        const procsResult = this.procComparator.compareProcedures(source.procedures, target.procedures, options);

        return new MetadataDiffResult(tablesResult, procsResult);
    }
}
