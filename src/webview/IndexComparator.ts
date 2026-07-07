import { IIndexDiff, IIndexInfo } from "../core/types";

export class IndexComparator {
    compare(srcIndexes: IIndexInfo[], tgtIndexes: IIndexInfo[], ignoreCase: boolean): IIndexDiff {
        const normalize = (name: string) => (ignoreCase ? name.toLowerCase() : name);
        const all = new Map<string, { source: IIndexInfo | null; target: IIndexInfo | null }>();
        srcIndexes.forEach((idx) => {
            const key = normalize(idx.name);
            if (!all.has(key)) all.set(key, { source: null, target: null });
            all.get(key)!.source = idx;
        });
        tgtIndexes.forEach((idx) => {
            const key = normalize(idx.name);
            if (!all.has(key)) all.set(key, { source: null, target: null });
            all.get(key)!.target = idx;
        });

        const onlyInSource: string[] = [];
        const onlyInTarget: string[] = [];
        const diff: { name: string; sourceDesc: string; targetDesc: string }[] = [];
        const caseDiff: { name: string; sourceName: string; targetName: string }[] = [];

        for (const [, pair] of all) {
            const src = pair.source;
            const tgt = pair.target;
            if (src && !tgt) {
                onlyInSource.push(src.name);
            } else if (!src && tgt) {
                onlyInTarget.push(tgt.name);
            } else if (src && tgt) {
                const srcName = src.name;
                const tgtName = tgt.name;
                if (!ignoreCase && srcName !== tgtName) {
                    caseDiff.push({ name: srcName, sourceName: srcName, targetName: tgtName });
                }
                const srcDesc = this.formatIndexDesc(src);
                const tgtDesc = this.formatIndexDesc(tgt);
                if (srcDesc !== tgtDesc) {
                    diff.push({ name: srcName, sourceDesc: srcDesc, targetDesc: tgtDesc });
                }
            }
        }

        return { onlyInSource, onlyInTarget, diff, caseDiff };
    }

    private formatIndexDesc(idx: IIndexInfo): string {
        let desc = "";
        if (idx.isUnique) desc += "UNIQUE ";
        if (idx.isClustered) desc += "CLUSTERED ";
        if (idx.columns) desc += `(${idx.columns.join(", ")})`;
        return desc.trim();
    }
}
