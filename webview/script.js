const vscode = acquireVsCodeApi();

function getDisplayName(schema, name, showSchema) {
  return showSchema ? `${schema}.${name}` : name;
}

function startCompare() {
  // Собираем маппинг из таблицы
  const normalizeSchema = getMappingFromTable();
  const viewMode = document.querySelector('input[name="viewMode"]:checked').value;
  console.log("Selected viewMode:", viewMode);

  const config = {
    source: document.getElementById("source").value.trim(),
    target: document.getElementById("target").value.trim(),
    normalizeTypes: document.getElementById("normalizeTypes").checked,
    normalizeSchemaEnabled: document.getElementById("normalizeSchemaEnabled").checked,
    ignoreCase: document.getElementById("ignoreCase").checked,
    useCache: document.getElementById("useCache").checked,
    normalizeSchema: normalizeSchema,
    viewMode: viewMode,
  };
  if (!config.source || !config.target) {
    alert("Заполните оба connection string");
    return;
  }

  setSettingsEnabled(false);
  document.getElementById('result').innerHTML = '';
  document.getElementById('status').innerHTML = '';

  vscode.postMessage({ command: "compare", config });
}

// ---------- Управление вкладками ----------
function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + tabId).classList.add('active');
  document.querySelectorAll('.tab-header').forEach(el => el.classList.remove('active'));
  document.querySelector(`.tab-header[data-tab="${tabId}"]`).classList.add('active');
}
// ---------- Блокировка/разблокировка контролов ----------
function setSettingsEnabled(enabled) {
const tabs = document.querySelectorAll('.tab-content');
    tabs.forEach(el => {
        if (enabled) {
            el.classList.remove('disabled');
        } else {
            el.classList.add('disabled');
        }
    });
      
  const settingsTab = document.getElementById('tab-settings');
  const inputs = settingsTab.querySelectorAll('input, textarea, button');
  inputs.forEach(el => {
    el.disabled = !enabled;
  });
  // Также блокируем кнопки добавления/удаления строк в таблице маппинга
  const mappingButtons = settingsTab.querySelectorAll('#addMappingRow, .removeMappingRow');
  mappingButtons.forEach(el => el.disabled = !enabled);
}
// Обработчики кликов по заголовкам вкладок
document.querySelectorAll('.tab-header').forEach(header => {
  header.addEventListener('click', function() {
    const tabId = this.dataset.tab;
    if (tabId === 'result') {
      const resultContent = document.getElementById('result').innerHTML;
      if (!resultContent || resultContent.trim() === '') {
        return;
      }
    }
    switchTab(tabId);
  });
});

// ---------- Управление таблицей маппинга ----------
function addMappingRow(source = '', target = '') {
  const tbody = document.getElementById('mappingBody');
  const row = document.createElement('tr');
  row.innerHTML = `
    <td><input type="text" class="mapping-source" value="${source}" placeholder="исходная схема" style="width:100%;"></td>
    <td><input type="text" class="mapping-target" value="${target}" placeholder="целевая схема" style="width:100%;"></td>
    <td><button type="button" class="removeMappingRow" style="background:transparent; border:none; color:var(--vscode-errorForeground); cursor:pointer;">✕</button></td>
  `;
  tbody.appendChild(row);
  
  // Обработчик удаления
  const removeBtn = row.querySelector('.removeMappingRow');
  removeBtn.addEventListener('click', function() {
    if (tbody.children.length > 1) {
      row.remove();
      saveMappingToStorage();
    } else {
      alert('Должна остаться хотя бы одна строка (можно оставить пустые поля).');
    }
  });

  // Обработчики изменения ввода – сохраняем при изменении
  const inputs = row.querySelectorAll('input');
  inputs.forEach(input => {
    input.addEventListener('input', saveMappingToStorage);
  });

  saveMappingToStorage();
}
// Инициализация таблицы: если есть старый JSON, парсим его и заполняем
function initMappingTable() {
  const mapping = loadMappingFromStorage();
  const tbody = document.getElementById('mappingBody');
  tbody.innerHTML = '';
  const entries = Object.entries(mapping);
  if (entries.length === 0) {
    addMappingRow('', '');
  } else {
    entries.forEach(([source, target]) => {
      addMappingRow(source, target);
    });
  }
}
// Сбор данных из таблицы в объект
function getMappingFromTable() {
  const rows = document.querySelectorAll('#mappingBody tr');
  const mapping = {};
  rows.forEach(row => {
    const sourceInput = row.querySelector('.mapping-source');
    const targetInput = row.querySelector('.mapping-target');
    if (sourceInput && targetInput) {
      const source = sourceInput.value.trim();
      const target = targetInput.value.trim();
      if (source && target) {
        mapping[source] = target;
      }
    }
  });
  return mapping;
}
// ------------------------------------------------------------------
// Рендерер детального режима
// ------------------------------------------------------------------
function renderDetailedView(source, target, diff, showSchema) {
  if (!diff) return '<div class="section"><p>Нет данных для сравнения.</p></div>';

  let html = "";

  // ---- Таблицы ----
  const hasTables = diff.onlyInSource?.length > 0 || diff.onlyInTarget?.length > 0 || diff.common?.length > 0 || diff.caseDifferences?.length > 0;
  if (hasTables) {
    html += '<div class="section">';
    html += "<h2>Таблицы</h2>";
    html += '<table class="compare-table"><thead><tr><th>Источник</th><th>Приёмник</th></tr></thead><tbody>';

    // Только в источнике
    if (diff.onlyInSource && diff.onlyInSource.length > 0) {
      diff.onlyInSource.forEach((t) => {
        const displayName = getDisplayName(t.schema, t.name, showSchema);
        html += `<tr class="only-source"><td>${displayName}</td><td></td></tr>`;
      });
    }
    // Только в приёмнике
    if (diff.onlyInTarget && diff.onlyInTarget.length > 0) {
      diff.onlyInTarget.forEach((t) => {
        const displayName = getDisplayName(t.schema, t.name, showSchema);
        html += `<tr class="only-target"><td></td><td>${displayName}</td></tr>`;
      });
    }
    // Общие таблицы с деталями
    if (diff.common && diff.common.length > 0) {
      diff.common.forEach((table) => {
        const displayName = getDisplayName(table.schema, table.name, showSchema);
        html += `<tr class="common"><td colspan="2"><strong>${displayName}</strong></td></tr>`;

        // ---- Колонки ----
        const cols = table.columns || { onlyInSource: [], onlyInTarget: [], diff: [], caseDiff: [] };
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
        if (cols.onlyInSource.length === 0 && cols.onlyInTarget.length === 0 && cols.diff.length === 0 && cols.caseDiff.length === 0) {
          html += `<tr><td colspan="2" class="indent" style="color:var(--vscode-disabledForeground);">(все колонки совпадают)</td></tr>`;
        }

        // ---- Индексы ----
        const idx = table.indexes || { onlyInSource: [], onlyInTarget: [], diff: [], caseDiff: [] };
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
        if (idx.onlyInSource.length === 0 && idx.onlyInTarget.length === 0 && idx.diff.length === 0 && idx.caseDiff.length === 0) {
          html += `<tr><td colspan="2" class="indent" style="color:var(--vscode-disabledForeground);">(все индексы совпадают)</td></tr>`;
        }
      });
    }

    // Регистровые различия имён таблиц
    if (diff.caseDifferences && diff.caseDifferences.length > 0) {
      html += `<tr class="diff-case"><td colspan="2"><strong>Различия в регистре имён таблиц</strong></td></tr>`;
      diff.caseDifferences.forEach((item) => {
        html += `<tr class="diff-case"><td class="indent">${item.sourceName}</td><td class="indent">${item.targetName}</td></tr>`;
      });
    }
    html += "</tbody></table></div>";
  }

  // ---- Процедуры ----
  const hasProcs = diff.onlyInSourceProcs?.length > 0 || diff.onlyInTargetProcs?.length > 0 || diff.commonProcs?.length > 0 || diff.caseDiffProcs?.length > 0;
  if (hasProcs) {
    html += '<div class="section">';
    html += "<h2>Процедуры</h2>";
    html += '<table class="compare-table"><thead><tr><th>Источник</th><th>Приёмник</th></tr></thead><tbody>';
    if (diff.onlyInSourceProcs && diff.onlyInSourceProcs.length > 0) {
      diff.onlyInSourceProcs.forEach((p) => {
        const displayName = getDisplayName(p.schema, p.name, showSchema);
        html += `<tr class="only-source"><td>${displayName}</td><td></td></tr>`;
      });
    }
    if (diff.onlyInTargetProcs && diff.onlyInTargetProcs.length > 0) {
      diff.onlyInTargetProcs.forEach((p) => {
        const displayName = getDisplayName(p.schema, p.name, showSchema);
        html += `<tr class="only-target"><td></td><td>${displayName}</td></tr>`;
      });
    }
    if (diff.commonProcs && diff.commonProcs.length > 0) {
      diff.commonProcs.forEach((p) => {
        const displayName = getDisplayName(p.schema, p.name, showSchema);
        html += `<tr class="common"><td colspan="2">${displayName}</td></tr>`;
        // Задел для параметров
      });
    }
    if (diff.caseDiffProcs && diff.caseDiffProcs.length > 0) {
      html += `<tr class="diff-case"><td colspan="2"><strong>Различия в регистре имён процедур</strong></td></tr>`;
      diff.caseDiffProcs.forEach((item) => {
        html += `<tr class="diff-case"><td class="indent">${item.sourceName}</td><td class="indent">${item.targetName}</td></tr>`;
      });
    }
    html += "</tbody></table></div>";
  }

  return html;
}

// ------------------------------------------------------------------
// Рендерер группировки по типам
// ------------------------------------------------------------------
function renderGroupedView(source, target, diff, showSchema) {
  let html = "";

  // ---- Таблицы ----
  const allTables = [];
  (diff.onlyInSource || []).forEach((t) => allTables.push({ ...t, status: "onlySource" }));
  (diff.onlyInTarget || []).forEach((t) => allTables.push({ ...t, status: "onlyTarget" }));
  (diff.common || []).forEach((table) => {
    allTables.push({
      schema: table.schema,
      name: table.name,
      status: "common",
      columns: table.columns,
      indexes: table.indexes,
    });
  });
  allTables.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  if (allTables.length > 0 || diff.caseDifferences?.length > 0) {
    html += '<div class="section"><h2>Таблицы</h2>';
    html += '<table class="compare-table"><thead><tr><th>Источник</th><th>Приёмник</th></tr></thead><tbody>';
    allTables.forEach((item) => {
      const displayName = getDisplayName(item.schema, item.name, showSchema);
      if (item.status === "onlySource") {
        html += `<tr class="only-source"><td>${displayName}</td><td></td></tr>`;
      } else if (item.status === "onlyTarget") {
        html += `<tr class="only-target"><td></td><td>${displayName}</td></tr>`;
      } else if (item.status === "common") {
        html += `<tr class="common"><td colspan="2"><strong>${displayName}</strong></td></tr>`;

        // ---- Колонки ----
        const cols = item.columns || { onlyInSource: [], onlyInTarget: [], diff: [], caseDiff: [] };
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
          cols.diff.forEach((itemDiff) => {
            html += `<tr class="diff"><td class="indent">${itemDiff.name}: ${itemDiff.sourceType}</td><td class="indent">${itemDiff.name}: ${itemDiff.targetType}</td></tr>`;
          });
        }
        if (cols.caseDiff && cols.caseDiff.length > 0) {
          cols.caseDiff.forEach((itemCase) => {
            html += `<tr class="diff-case"><td class="indent">${itemCase.sourceName}</td><td class="indent">${itemCase.targetName}</td></tr>`;
          });
        }
        if (cols.onlyInSource.length === 0 && cols.onlyInTarget.length === 0 && cols.diff.length === 0 && cols.caseDiff.length === 0) {
          html += `<tr><td colspan="2" class="indent" style="color:var(--vscode-disabledForeground);">(все колонки совпадают)</td></tr>`;
        }

        // ---- Индексы ----
        const idx = item.indexes || { onlyInSource: [], onlyInTarget: [], diff: [], caseDiff: [] };
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
          idx.diff.forEach((itemDiff) => {
            html += `<tr class="diff"><td class="indent">[Индекс] ${itemDiff.name}: ${itemDiff.sourceDesc}</td><td class="indent">[Индекс] ${itemDiff.name}: ${itemDiff.targetDesc}</td></tr>`;
          });
        }
        if (idx.caseDiff && idx.caseDiff.length > 0) {
          idx.caseDiff.forEach((itemCase) => {
            html += `<tr class="diff-case"><td class="indent">[Индекс] ${itemCase.sourceName}</td><td class="indent">[Индекс] ${itemCase.targetName}</td></tr>`;
          });
        }
        if (idx.onlyInSource.length === 0 && idx.onlyInTarget.length === 0 && idx.diff.length === 0 && idx.caseDiff.length === 0) {
          html += `<tr><td colspan="2" class="indent" style="color:var(--vscode-disabledForeground);">(все индексы совпадают)</td></tr>`;
        }
      }
    });

    if (diff.caseDifferences && diff.caseDifferences.length > 0) {
      html += `<tr class="diff-case"><td colspan="2"><strong>Различия в регистре имён таблиц</strong></td></tr>`;
      diff.caseDifferences.forEach((item) => {
        html += `<tr class="diff-case"><td class="indent">${item.sourceName}</td><td class="indent">${item.targetName}</td></tr>`;
      });
    }
    html += "</tbody></table></div>";
  }

  // ---- Процедуры ----
  const allProcs = [];
  (diff.onlyInSourceProcs || []).forEach((p) => allProcs.push({ ...p, status: "onlySource" }));
  (diff.onlyInTargetProcs || []).forEach((p) => allProcs.push({ ...p, status: "onlyTarget" }));
  (diff.commonProcs || []).forEach((p) => allProcs.push({ ...p, status: "common" }));
  allProcs.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  if (allProcs.length > 0 || diff.caseDiffProcs?.length > 0) {
    html += '<div class="section"><h2>Процедуры</h2>';
    html += '<table class="compare-table"><thead><tr><th>Источник</th><th>Приёмник</th></tr></thead><tbody>';
    allProcs.forEach((item) => {
      const displayName = getDisplayName(item.schema, item.name, showSchema);
      if (item.status === "onlySource") {
        html += `<tr class="only-source"><td>${displayName}</td><td></td></tr>`;
      } else if (item.status === "onlyTarget") {
        html += `<tr class="only-target"><td></td><td>${displayName}</td></tr>`;
      } else if (item.status === "common") {
        html += `<tr class="common"><td colspan="2">${displayName}</td></tr>`;
        // Задел для параметров
      }
    });
    if (diff.caseDiffProcs && diff.caseDiffProcs.length > 0) {
      html += `<tr class="diff-case"><td colspan="2"><strong>Различия в регистре имён процедур</strong></td></tr>`;
      diff.caseDiffProcs.forEach((item) => {
        html += `<tr class="diff-case"><td class="indent">${item.sourceName}</td><td class="indent">${item.targetName}</td></tr>`;
      });
    }
    html += "</tbody></table></div>";
  }

  return html;
}

// ------------------------------------------------------------------
// Основной рендерер, выбирающий режим
// ------------------------------------------------------------------
function renderComparison(source, target, diff, viewMode, normalizeSchemaEnabled) {
  console.log("renderComparison called with viewMode:", viewMode, "normalizeSchemaEnabled:", normalizeSchemaEnabled);
  if (!source || !target || !diff) {
    return '<div class="section"><p>Нет данных для сравнения.</p></div>';
  }
  const showSchema = !normalizeSchemaEnabled;
  if (viewMode === "grouped") {
    return renderGroupedView(source, target, diff, showSchema);
  } else {
    // detailed – по умолчанию
    return renderDetailedView(source, target, diff, showSchema);
  }
}

// ----- Обработчик сообщений -----
window.addEventListener("message", (event) => {
  const msg = event.data;
  const statusEl = document.getElementById("status");
  const resultEl = document.getElementById("result");

  if (msg.command === "loading") {
    if (msg.status) {
      statusEl.innerHTML = `<p class="loading">${msg.message || "Извлечение метаданных..."}</p>`;
    } else {
      statusEl.innerHTML = "";
    }
  } else if (msg.command === "error") {
    statusEl.innerHTML = `<p class="error">${msg.message}</p>`;
    console.error("Error from extension:", msg.message);
    setSettingsEnabled(true);
  } else if (msg.command === "result") {
    statusEl.innerHTML = "";
    console.log("Received result with viewMode:", msg.viewMode);
    try {
      const viewMode = msg.viewMode || "detailed";
      const normalizeSchemaEnabled = msg.normalizeSchemaEnabled || false;
      const html = renderComparison(msg.source, msg.target, msg.diff, viewMode, normalizeSchemaEnabled);
      resultEl.innerHTML = html;
      switchTab('result');
    } catch (e) {
      console.error("Error in renderComparison:", e);
      resultEl.innerHTML = `<p class="error">Ошибка рендеринга: ${e.message}</p>`;
      statusEl.innerHTML = `<p class="error">Ошибка рендеринга: ${e.message}</p>`;
      setSettingsEnabled(true);
    } finally {
      setSettingsEnabled(true);
    }
  }
});

// При загрузке страницы: убедимся, что настройки разблокированы
document.addEventListener('DOMContentLoaded', () => {
  initMappingTable();

  document.getElementById('addMappingRow').addEventListener('click', () => {
    addMappingRow('', '');
  });

  setSettingsEnabled(true);
  switchTab('settings');
});

function saveMappingToStorage() {
  const mapping = getMappingFromTable();
  localStorage.setItem('dbCompareMapping', JSON.stringify(mapping));
}

function loadMappingFromStorage() {
  const data = localStorage.getItem('dbCompareMapping');
  if (data) {
    try {
      return JSON.parse(data);
    } catch (e) {
      return {};
    }
  }
  return {};
}