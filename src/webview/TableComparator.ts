import { MetadataBuilder } from "../core/metadata-builder";
import { CompareOptions, IColumnDiff, ICompareResult, IIndexDiff, ITableDiff, ITableInfo } from "../core/types";
import { ColumnComparator } from "./ColumnComparator";
import { IndexComparator } from "./IndexComparator";

export class TableComparator {
    private columnComparator = new ColumnComparator();
    private indexComparator = new IndexComparator();

    compareTables(srcTables: ITableInfo[], tgtTables: ITableInfo[], options: CompareOptions): ICompareResult<ITableInfo, ITableDiff> {
        const normalizeName = (schema: string, name: string) => MetadataBuilder.normalizeName(schema, name, options.ignoreCase);

        const allTables = new Map<string, { source: ITableInfo | null; target: ITableInfo | null }>();
        srcTables.forEach((t) => {
            const key = normalizeName(t.schema, t.name);
            if (!allTables.has(key)) allTables.set(key, { source: null, target: null });
            allTables.get(key)!.source = t;
        });
        tgtTables.forEach((t) => {
            const key = normalizeName(t.schema, t.name);
            if (!allTables.has(key)) allTables.set(key, { source: null, target: null });
            allTables.get(key)!.target = t;
        });

        const onlyInSource: ITableInfo[] = [];
        const onlyInTarget: ITableInfo[] = [];
        const common: ITableDiff[] = [];
        const caseDifferences: { schema: string; name: string; sourceName: string; targetName: string }[] = [];

        for (const [, pair] of allTables) {
            if (pair.source && !pair.target) {
                onlyInSource.push(pair.source);
            } else if (!pair.source && pair.target) {
                onlyInTarget.push(pair.target);
            } else if (pair.source && pair.target) {
                const result = this.pushCommon(pair.source, pair.target, options);
                if (result) {
                    common.push(result);
                }
            }
        }

        return { onlyInSource, onlyInTarget, common, caseDifferences };
    }

    private pushCommon(src: ITableInfo, tgt: ITableInfo, options: CompareOptions): ITableDiff | null {
        const srcFull = `${src.schema}.${src.name}`;
        const tgtFull = `${tgt.schema}.${tgt.name}`;

        // Регистровые различия добавляем в caseDifferences (но они не влияют на hasRealDiff)
        // Они будут добавлены в общий результат, но мы не можем добавить их здесь,
        // так как caseDifferences собирается отдельно. Поэтому мы просто проверяем наличие
        // и если ignoreCase выключен, то добавляем в массив caseDifferences (это делается в основном цикле).
        // Поэтому здесь просто выполняем сравнение деталей.
        const colDetails = this.columnComparator.compare(src.columns, tgt.columns, options.ignoreCase);
        const indexDetails = this.indexComparator.compare(src.indexes, tgt.indexes, options.ignoreCase);
        const hasRealDiff = this.hasRealDifferences(colDetails, indexDetails, options.ignoreCase);

        if (options.hideIdentical && !hasRealDiff) {
            return null;
        }

        return {
            schema: src.schema,
            name: src.name,
            columns: colDetails,
            indexes: indexDetails,
        };
    }

    private hasRealDifferences(colDetails: IColumnDiff, indexDetails: IIndexDiff, ignoreCase: boolean): boolean {
        const hasColDiff = colDetails.onlyInSource.length > 0 || colDetails.onlyInTarget.length > 0 || colDetails.diff.length > 0;
        const hasIdxDiff = indexDetails.onlyInSource.length > 0 || indexDetails.onlyInTarget.length > 0 || indexDetails.diff.length > 0;
        const hasCaseDiff = colDetails.caseDiff.length > 0 || indexDetails.caseDiff.length > 0;
        return hasColDiff || hasIdxDiff || (hasCaseDiff && !ignoreCase);
    }
}
