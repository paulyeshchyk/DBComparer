import { MetadataBuilder } from "../core/metadata-builder";
import { CompareOptions, ICompareResult, IProcedureDiff, IProcedureInfo } from "../core/types";
import { ParameterComparator } from "./ParameterComparator";

export class ProcedureComparator {
    private paramComparator = new ParameterComparator();

    compareProcedures(srcProcs: IProcedureInfo[], tgtProcs: IProcedureInfo[], options: CompareOptions): ICompareResult<IProcedureInfo, IProcedureDiff> {
        const normalizeName = (schema: string, name: string) => MetadataBuilder.normalizeName(schema, name, options.ignoreCase);

        const allProcs = new Map<string, { source: IProcedureInfo | null; target: IProcedureInfo | null }>();
        srcProcs.forEach((p) => {
            const key = normalizeName(p.schema, p.name);
            if (!allProcs.has(key)) allProcs.set(key, { source: null, target: null });
            allProcs.get(key)!.source = p;
        });
        tgtProcs.forEach((p) => {
            const key = normalizeName(p.schema, p.name);
            if (!allProcs.has(key)) allProcs.set(key, { source: null, target: null });
            allProcs.get(key)!.target = p;
        });

        const onlyInSource: IProcedureInfo[] = [];
        const onlyInTarget: IProcedureInfo[] = [];
        const common: IProcedureDiff[] = [];
        const caseDifferences: { schema: string; name: string; sourceName: string; targetName: string }[] = [];

        for (const [, pair] of allProcs) {
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

    private pushCommon(src: IProcedureInfo, tgt: IProcedureInfo, options: CompareOptions): IProcedureDiff | null {
        const srcFull = `${src.schema}.${src.name}`;
        const tgtFull = `${tgt.schema}.${tgt.name}`;

        // Сравниваем параметры
        const paramDetails = this.paramComparator.compare(src.parameters || [], tgt.parameters || [], options.ignoreCase);

        // Проверяем наличие реальных различий (имя + параметры)
        const nameDiff = !options.ignoreCase && srcFull !== tgtFull;
        const hasParamDiff = paramDetails.onlyInSource.length > 0 || paramDetails.onlyInTarget.length > 0 || paramDetails.diff.length > 0 || (paramDetails.caseDiff.length > 0 && !options.ignoreCase);
        const hasRealDiff = nameDiff || hasParamDiff;

        if (options.hideIdentical && !hasRealDiff) {
            return null;
        }

        return {
            schema: src.schema,
            name: src.name,
            parameters: paramDetails,
        };
    }
}
