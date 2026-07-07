import { IColumnDiff, IColumnInfo } from "../core/types";

export class ColumnComparator {
    compare(srcCols: IColumnInfo[], tgtCols: IColumnInfo[], ignoreCase: boolean): IColumnDiff {
        const normalize = (name: string) => (ignoreCase ? name.toLowerCase() : name);
        const all = new Map<string, { source: IColumnInfo | null; target: IColumnInfo | null }>();
        srcCols.forEach((c) => {
            const key = normalize(c.name);
            if (!all.has(key)) all.set(key, { source: null, target: null });
            all.get(key)!.source = c;
        });
        tgtCols.forEach((c) => {
            const key = normalize(c.name);
            if (!all.has(key)) all.set(key, { source: null, target: null });
            all.get(key)!.target = c;
        });

        const onlyInSource: string[] = [];
        const onlyInTarget: string[] = [];
        const diff: { name: string; sourceType: string; targetType: string }[] = [];
        const caseDiff: { name: string; sourceName: string; targetName: string }[] = [];

        for (const [, pair] of all) {
            const srcCol = pair.source;
            const tgtCol = pair.target;
            if (srcCol && !tgtCol) {
                onlyInSource.push(srcCol.name);
            } else if (!srcCol && tgtCol) {
                onlyInTarget.push(tgtCol.name);
            } else if (srcCol && tgtCol) {
                const srcName = srcCol.name;
                const tgtName = tgtCol.name;
                if (!ignoreCase && srcName !== tgtName) {
                    caseDiff.push({ name: srcName, sourceName: srcName, targetName: tgtName });
                }
                const srcDesc = this.formatColumnDesc(srcCol);
                const tgtDesc = this.formatColumnDesc(tgtCol);
                if (srcDesc !== tgtDesc) {
                    diff.push({ name: srcName, sourceType: srcDesc, targetType: tgtDesc });
                }
            }
        }

        return { onlyInSource, onlyInTarget, diff, caseDiff };
    }

    private formatColumnDesc(col: IColumnInfo): string {
        let desc = col.dataType || "";
        if (!col.isNullable) desc += " NOT NULL";
        else desc += " NULL";
        if (col.isPrimaryKey) desc += " PK";
        return desc;
    }
}
