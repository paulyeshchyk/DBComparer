import { IParameterDiff, IParameterInfo } from "../core/types";

export class ParameterComparator {
    compare(srcParams: IParameterInfo[], tgtParams: IParameterInfo[], ignoreCase: boolean): IParameterDiff {
        const normalize = (name: string) => (ignoreCase ? name.toLowerCase() : name);
        const all = new Map<string, { source: IParameterInfo | null; target: IParameterInfo | null }>();
        srcParams.forEach((p) => {
            const key = normalize(p.name);
            if (!all.has(key)) all.set(key, { source: null, target: null });
            all.get(key)!.source = p;
        });
        tgtParams.forEach((p) => {
            const key = normalize(p.name);
            if (!all.has(key)) all.set(key, { source: null, target: null });
            all.get(key)!.target = p;
        });

        const onlyInSource: string[] = [];
        const onlyInTarget: string[] = [];
        const diff: { name: string; sourceType: string; targetType: string }[] = [];
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
                const srcDesc = this.formatParamDesc(src);
                const tgtDesc = this.formatParamDesc(tgt);
                if (srcDesc !== tgtDesc) {
                    diff.push({ name: srcName, sourceType: srcDesc, targetType: tgtDesc });
                }
            }
        }

        return { onlyInSource, onlyInTarget, diff, caseDiff };
    }

    private formatParamDesc(p: IParameterInfo): string {
        let desc = p.dataType || "";
        if (!p.isNullable) desc += " NOT NULL";
        else desc += " NULL";
        if (p.isOutput) desc += " OUTPUT";
        if (p.maxLength && p.maxLength > 0) desc += `(${p.maxLength})`;
        else if (p.precision && p.scale !== undefined) desc += `(${p.precision},${p.scale})`;
        return desc;
    }
}
