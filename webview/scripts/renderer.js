import { getDisplayName } from "./config";
import { setSettingsEnabled } from "./ui";
import { switchTab } from "./ui";

export function renderCommonTable(table, showSchema, hideIdentical, ignoreCase) {
  const displayName = getDisplayName(table.schema, table.name, showSchema);
  const cols = table.columns || { onlyInSource: [], onlyInTarget: [], diff: [], caseDiff: [] };
  const idx = table.indexes || { onlyInSource: [], onlyInTarget: [], diff: [], caseDiff: [] };

  const hasDiff = hasDifferences(table, ignoreCase);

  if (hideIdentical && !hasDiff) {
    return "";
  }

  let html = `<tr class="metadata-header"><td colspan="2"><strong>${displayName}</strong></td></tr>`;
    html += renderColumnsDetails(cols, hideIdentical);
    html += renderIndexDetails(idx, hideIdentical);
    return html;
}

export function hasDifferences(table, ignoreCase) {
  const cols = table.columns || {};
  const idx = table.indexes || {};
  const hasColDiff = cols.onlyInSource?.length > 0 || cols.onlyInTarget?.length > 0 || cols.diff?.length > 0;
  const hasIdxDiff = idx.onlyInSource?.length > 0 || idx.onlyInTarget?.length > 0 || idx.diff?.length > 0;
  const hasCaseDiff = cols.caseDiff?.length > 0 || idx.caseDiff?.length > 0;
  return hasColDiff || hasIdxDiff || (hasCaseDiff && !ignoreCase);
}

export function renderResult(source, target, diff, viewMode, normalizeSchemaEnabled, hideIdentical, ignoreCase) {
  const html = renderComparison(source, target, diff, viewMode, normalizeSchemaEnabled, hideIdentical, ignoreCase);
  document.getElementById("result").innerHTML = html;
  switchTab("result");
  setSettingsEnabled(true);
}
// =================================================================
// РЕНДЕРЕРЫ
// =================================================================

export function renderColumnsDetails(cols, hideIdentical) {
  let html = "";
  const hasDiff = cols.onlyInSource?.length > 0 || cols.onlyInTarget?.length > 0 || cols.diff?.length > 0 || cols.caseDiff?.length > 0;

  if (hasDiff || !hideIdentical) {
    if (cols.onlyInSource && cols.onlyInSource.length > 0) {
      cols.onlyInSource.forEach((colName) => {
        html += `<tr class="only-source"><td class="indent">${colName}</td><td></td></tr>`;
      });
    }
    if (cols.onlyInTarget && cols.onlyInTarget.length > 0) {
      cols.onlyInTarget.forEach((colName) => {
        html += `<tr class="only-target"><td></td><td class="indent">${colName}</td></tr>`;
      });
    }
    if (cols.diff && cols.diff.length > 0) {
      cols.diff.forEach((item) => {
        html += `<tr class="diff"><td class="indent">${item.name}: ${item.sourceType}</td><td class="indent">${item.name}: ${item.targetType}</td></tr>`;
      });
    }
    if (cols.caseDiff && cols.caseDiff.length > 0) {
      cols.caseDiff.forEach((item) => {
        html += `<tr class="diff-case"><td class="indent">${item.sourceName}</td><td class="indent">${item.targetName}</td></tr>`;
      });
    }
    if (!hasDiff && !hideIdentical) {
      html += `<tr><td colspan="2" class="indent" style="color:var(--vscode-disabledForeground);">(все колонки совпадают)</td></tr>`;
    }
  }
  return html;
}

export function renderIndexDetails(idx, hideIdentical) {
  let html = "";
  const hasDiff = idx.onlyInSource?.length > 0 || idx.onlyInTarget?.length > 0 || idx.diff?.length > 0 || idx.caseDiff?.length > 0;

  if (hasDiff || !hideIdentical) {
    if (idx.onlyInSource && idx.onlyInSource.length > 0) {
      idx.onlyInSource.forEach((idxName) => {
        html += `<tr class="only-source"><td class="indent">[Индекс] ${idxName}</td><td></td></tr>`;
      });
    }
    if (idx.onlyInTarget && idx.onlyInTarget.length > 0) {
      idx.onlyInTarget.forEach((idxName) => {
        html += `<tr class="only-target"><td></td><td class="indent">[Индекс] ${idxName}</td></tr>`;
      });
    }
    if (idx.diff && idx.diff.length > 0) {
      idx.diff.forEach((item) => {
        html += `<tr class="diff"><td class="indent">[Индекс] ${item.name}: ${item.sourceDesc}</td><td class="indent">[Индекс] ${item.name}: ${item.targetDesc}</td></tr>`;
      });
    }
    if (idx.caseDiff && idx.caseDiff.length > 0) {
      idx.caseDiff.forEach((item) => {
        html += `<tr class="diff-case"><td class="indent">[Индекс] ${item.sourceName}</td><td class="indent">[Индекс] ${item.targetName}</td></tr>`;
      });
    }
    if (!hasDiff && !hideIdentical) {
      html += `<tr><td colspan="2" class="indent" style="color:var(--vscode-disabledForeground);">(все индексы совпадают)</td></tr>`;
    }
  }
  return html;
}

export function renderOnlyInSourceTable(table, showSchema) {
    const displayName = getDisplayName(table.schema, table.name, showSchema);
    return `<tr class="metadata-header"><td>${displayName}</td><td></td></tr>`;
}

export function renderOnlyInTargetTable(table, showSchema) {
    const displayName = getDisplayName(table.schema, table.name, showSchema);
    return `<tr class="metadata-header"><td></td><td>${displayName}</td></tr>`;
}

export function renderTablesDetailed(diffTables, showSchema, hideIdentical, ignoreCase) {
  const hasTables = diffTables.onlyInSource?.length > 0 || diffTables.onlyInTarget?.length > 0 || diffTables.common?.length > 0 || diffTables.caseDifferences?.length > 0;
  if (!hasTables) return "";

  let html = '<div class="section"><h2>Таблицы</h2>';
  html += '<table class="compare-table"><thead><tr><th>Источник</th><th>Приёмник</th></tr></thead><tbody>';

  if (diffTables.onlyInSource) {
    diffTables.onlyInSource.forEach((t) => {
      html += renderOnlyInSourceTable(t, showSchema);
    });
  }
  if (diffTables.onlyInTarget) {
    diffTables.onlyInTarget.forEach((t) => {
      html += renderOnlyInTargetTable(t, showSchema);
    });
  }
  if (diffTables.common) {
    diffTables.common.forEach((table) => {
      html += renderCommonTable(table, showSchema, hideIdentical, ignoreCase);
    });
  }
  if (diffTables.caseDifferences && diffTables.caseDifferences.length > 0 && !ignoreCase) {
    html += `<tr class="diff-case"><td colspan="2"><strong>Различия в регистре имён таблиц</strong></td></tr>`;
    diffTables.caseDifferences.forEach((item) => {
      html += `<tr class="diff-case"><td class="indent">${item.sourceName}</td><td class="indent">${item.targetName}</td></tr>`;
    });
  }
  html += "</tbody></table></div>";
  return html;
}
export function renderTablesGrouped(diffTables, showSchema, hideIdentical, ignoreCase) {
  const allTables = [];
  (diffTables.onlyInSource || []).forEach((t) => allTables.push({ ...t, status: "onlySource" }));
  (diffTables.onlyInTarget || []).forEach((t) => allTables.push({ ...t, status: "onlyTarget" }));
  (diffTables.common || []).forEach((table) => {
    allTables.push({
      schema: table.schema,
      name: table.name,
      status: "common",
      columns: table.columns,
      indexes: table.indexes,
    });
  });
  allTables.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const filteredTables = allTables.filter((item) => {
    if (item.status !== "common") return true;
    return !(hideIdentical && !hasDifferences(item, ignoreCase));
  });

  if (filteredTables.length === 0 && (!diffTables.caseDifferences || diffTables.caseDifferences.length === 0)) {
    return "";
  }

  let html = '<div class="section"><h2>Таблицы</h2>';
  html += '<table class="compare-table"><thead><tr><th>Источник</th><th>Приёмник</th></tr></thead><tbody>';

  filteredTables.forEach((item) => {
    const displayName = getDisplayName(item.schema, item.name, showSchema);
    if (item.status === "onlySource") {
      html += renderOnlyInSourceTable(item, showSchema);
    } else if (item.status === "onlyTarget") {
      html += renderOnlyInTargetTable(item, showSchema);
    } else if (item.status === "common") {
      html += renderCommonTable(item, showSchema, hideIdentical, ignoreCase);
    }
  });

  if (diffTables.caseDifferences && diffTables.caseDifferences.length > 0 && !ignoreCase) {
    html += `<tr class="diff-case"><td colspan="2"><strong>Различия в регистре имён таблиц</strong></td></tr>`;
    diffTables.caseDifferences.forEach((item) => {
      html += `<tr class="diff-case"><td class="indent">${item.sourceName}</td><td class="indent">${item.targetName}</td></tr>`;
    });
  }
  html += "</tbody></table></div>";
  return html;
}
export function renderProcedures(diffProcs, showSchema, hideIdentical, ignoreCase) {
  const hasProcs = diffProcs.onlyInSource?.length > 0 || diffProcs.onlyInTarget?.length > 0 || diffProcs.common?.length > 0 || diffProcs.caseDifferences?.length > 0;
  if (!hasProcs) return "";

  let html = '<div class="section"><h2>Процедуры</h2>';
  html += '<table class="compare-table"><thead><tr><th>Источник</th><th>Приёмник</th></tr></thead><tbody>';

  if (diffProcs.onlyInSource) {
    diffProcs.onlyInSource.forEach((p) => {
      const displayName = getDisplayName(p.schema, p.name, showSchema);
      html += `<tr class="metadata-header"><td>${displayName}</td><td></td></tr>`;
    });
  }
  if (diffProcs.onlyInTarget) {
    diffProcs.onlyInTarget.forEach((p) => {
      const displayName = getDisplayName(p.schema, p.name, showSchema);
      html += `<tr class="metadata-header"><td></td><td>${displayName}</td></tr>`;
    });
  }
  if (diffProcs.common) {
    diffProcs.common.forEach((p) => {
      const displayName = getDisplayName(p.schema, p.name, showSchema);
      html += `<tr class="metadata-header"><td colspan="2">${displayName}</td></tr>`;

      // ---- ВЫВОД ПАРАМЕТРОВ (восстановлено) ----
      if (p.parameters) {
        const paramDetails = p.parameters;
        if (paramDetails.onlyInSource.length > 0) {
          paramDetails.onlyInSource.forEach(paramName => {
            html += `<tr class="only-source"><td class="indent">[Параметр] ${paramName}</td><td></td></tr>`;
          });
        }
        if (paramDetails.onlyInTarget.length > 0) {
          paramDetails.onlyInTarget.forEach(paramName => {
            html += `<tr class="only-target"><td></td><td class="indent">[Параметр] ${paramName}</td></tr>`;
          });
        }
        if (paramDetails.diff.length > 0) {
          paramDetails.diff.forEach(item => {
            html += `<tr class="diff"><td class="indent">[Параметр] ${item.name}: ${item.sourceType}</td><td class="indent">[Параметр] ${item.name}: ${item.targetType}</td></tr>`;
          });
        }
        if (paramDetails.caseDiff.length > 0 && !ignoreCase) {
          paramDetails.caseDiff.forEach(item => {
            html += `<tr class="diff-case"><td class="indent">[Параметр] ${item.sourceName}</td><td class="indent">[Параметр] ${item.targetName}</td></tr>`;
          });
        }
      }
    });
  }
  if (diffProcs.caseDifferences && diffProcs.caseDifferences.length > 0 && !ignoreCase) {
    html += `<tr class="diff-case"><td colspan="2"><strong>Различия в регистре имён процедур</strong></td></tr>`;
    diffProcs.caseDifferences.forEach((item) => {
      html += `<tr class="diff-case"><td class="indent">${item.sourceName}</td><td class="indent">${item.targetName}</td></tr>`;
    });
  }
  html += "</tbody></table></div>";
  return html;
}

export function renderDetailedView(diff, showSchema, hideIdentical, ignoreCase) {
  if (!diff) return '<div class="section"><p>Нет данных для сравнения.</p></div>';
  let html = "";
  html += renderTablesDetailed(diff.tables, showSchema, hideIdentical, ignoreCase);
  html += renderProcedures(diff.procedures, showSchema, hideIdentical, ignoreCase);
  return html;
}
export function renderGroupedView(diff, showSchema, hideIdentical, ignoreCase) {
  if (!diff) return '<div class="section"><p>Нет данных для сравнения.</p></div>';
  let html = "";
  html += renderTablesGrouped(diff.tables, showSchema, hideIdentical, ignoreCase);
  html += renderProcedures(diff.procedures, showSchema, hideIdentical, ignoreCase);
  return html;
}
export function renderComparison(source, target, diff, viewMode, normalizeSchemaEnabled, hideIdentical, ignoreCase) {
  if (!source || !target || !diff) {
    return '<div class="section"><p>Нет данных для сравнения.</p></div>';
  }
  const showSchema = !normalizeSchemaEnabled;
  if (viewMode === "grouped") {
    return renderGroupedView(diff, showSchema, hideIdentical, ignoreCase);
  } else {
    return renderDetailedView(diff, showSchema, hideIdentical, ignoreCase);
  }
}
