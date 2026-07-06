import { checkCacheAndUpdateButton, refreshCacheList, renderCacheList } from "./cache";
import { getCurrentConfig } from "./config";
import { initFilters } from "./filters";
import { addMappingRow, initMappingTable } from "./mapping";
import { renderResult } from "./renderer";
import { setSettingsEnabled, switchTab } from "./ui";

export const vscode = acquireVsCodeApi();

// ---------- Запуск сравнения ----------
function startCompare() {
  const config = getCurrentConfig();
  if (!config.source || !config.target) {
    alert("Заполните оба connection string");
    return;
  }
  setSettingsEnabled(false);
  document.getElementById("result").innerHTML = "";
  vscode.postMessage({ command: "compare", config, useCache: false });
}

function showLogs() {
  vscode.postMessage({ command: "showLogsOutputChannel" })
}

function startCompareFromCache() {
  const config = getCurrentConfig();
  if (!config.source || !config.target) {
    alert("Заполните оба connection string");
    return;
  }
  setSettingsEnabled(false);
  document.getElementById("result").innerHTML = "";
  vscode.postMessage({ command: "compare", config, useCache: true });
}

// =================================================================
// ОБРАБОТЧИК СООБЩЕНИЙ ОТ РАСШИРЕНИЯ
// =================================================================
const commandHandlers = {
  loading: (msg) => {
    // ничего не делаем. всё в логах        
  },
  error: (msg) => {
    console.error("Error from extension:", msg.message);
    setSettingsEnabled(true);
  },
  result: (msg) => {
    const resultEl = document.getElementById("result");
    try {
      const viewMode = msg.viewMode || "detailed";
      const normalizeSchemaEnabled = msg.normalizeSchemaEnabled || false;
      const ignoreCase = msg.ignoreCase || false;
      renderResult(msg.source, msg.target, msg.diff, viewMode, normalizeSchemaEnabled, ignoreCase);
      checkCacheAndUpdateButton();
    } catch (e) {
      console.error("Error in renderComparison:", e);
      resultEl.innerHTML = `<p class="error">Ошибка рендеринга: ${e.message}</p>`;
      statusEl.innerHTML = `<p class="error">Ошибка рендеринга: ${e.message}</p>`;
      setSettingsEnabled(true);
      checkCacheAndUpdateButton();
    }
  },
  cacheList: (msg) => renderCacheList(msg.list),
  cacheDeleted: () => {
    refreshCacheList();
    checkCacheAndUpdateButton();
  },
  cacheExported: () => {
    vscode.window.showInformationMessage("Кэш успешно экспортирован");
    checkCacheAndUpdateButton();
  }
};

window.addEventListener("message", (event) => {
  const handler = commandHandlers[event.data.command];
  if (handler) {
    handler(event.data);
  } else {
    console.warn("Unknown command:", event.data.command);
  }
});

document.querySelector('.tab-header[data-tab="cache"]').addEventListener("click", refreshCacheList);

// =================================================================
// ИНИЦИАЛИЗАЦИЯ
// =================================================================

document.addEventListener("DOMContentLoaded", () => {
  initMappingTable();
  initFilters();
  document.getElementById("addMappingRow").addEventListener("click", () => addMappingRow("", ""));
  setSettingsEnabled(true);
  switchTab("settings");

  const sourceInput = document.getElementById("source");
  const targetInput = document.getElementById("target");
  sourceInput.addEventListener("input", checkCacheAndUpdateButton);
  targetInput.addEventListener("input", checkCacheAndUpdateButton);
  // Первоначальная проверка
  setTimeout(checkCacheAndUpdateButton, 100);
});

document.getElementById('runBtn').addEventListener('click', startCompare);
document.getElementById('runFromCacheBtn').addEventListener('click', startCompareFromCache);
document.getElementById('showLogsBtn').addEventListener('click', showLogs);

// Обработчики кликов по заголовкам вкладок (блокируем переход на "Результат", если нет контента)
document.querySelectorAll(".tab-header").forEach((header) => {
  header.addEventListener("click", function () {
    const tabId = this.dataset.tab;
    if (tabId === "result") {
      const resultContent = document.getElementById("result").innerHTML;
      if (!resultContent || resultContent.trim() === "") {
        return;
      }
    }
    switchTab(tabId);
  });
});
