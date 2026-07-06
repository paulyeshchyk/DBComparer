import { getCurrentConfig } from "./config";
import { vscode } from "./main";

// =================================================================
// УПРАВЛЕНИЕ СПИСКОМ КЭША
// =================================================================
export function loadCacheList() {
  return new Promise((resolve) => {
    const handler = (event) => {
      if (event.data.command === "cacheList") {
        window.removeEventListener("message", handler);
        resolve(event.data.list);
      }
    };
    window.addEventListener("message", handler);
    vscode.postMessage({ command: "getCacheList" });
  });
}

export function renderCacheList(list) {
  const container = document.getElementById('cacheList');
  if (!list || list.length === 0) {
    container.innerHTML = '<div class="section"><p>Нет сохранённых кэшей.</p></div>';
    return;
  }

  let html = '<div class="section"><h2>Сохранённые кэши</h2>';
  html += '<table class="cache-table"><thead><tr><th>#</th><th>Источник</th><th>Приёмник</th><th>Действия</th></tr></thead><tbody>';

  list.forEach((item, index) => {
    const num = index + 1;
    html += `<tr>
            <td>${num}</td>
            <td>${item.sourceName || '—'}</td>
            <td>${item.targetName || '—'}</td>
            <td>
                <button class="delete-cache" data-hash="${item.hash}">🗑️</button>
                <button class="export-cache" data-hash="${item.hash}">💾</button>
            </td>
        </tr>`;
  });

  html += '</tbody></table></div>';
  container.innerHTML = html;

  // Обработчики для кнопок
  container.querySelectorAll('.delete-cache').forEach(btn => {
    btn.addEventListener('click', function () {
      const hash = this.dataset.hash;
      vscode.postMessage({ command: 'deleteCache', hash: hash });
    });
  });

  container.querySelectorAll('.export-cache').forEach(btn => {
    btn.addEventListener('click', function () {
      const hash = this.dataset.hash;
      vscode.postMessage({ command: 'exportCache', hash: hash });
    });
  });
}

export async function refreshCacheList() {
  const list = await loadCacheList();
  renderCacheList(list);
}
// =================================================================
// ПРОВЕРКА КЭША И ОБНОВЛЕНИЕ СОСТОЯНИЯ КНОПОК
// =================================================================
export async function checkCacheAndUpdateButton() {
  const config = getCurrentConfig();
  const runBtn = document.getElementById("runFromCacheBtn");
  const resultTabHeader = document.querySelector('.tab-header[data-tab="result"]');
  const resultContent = document.getElementById("result").innerHTML;

  if (!config.source || !config.target) {
    runBtn.disabled = true;
    if (!resultContent || resultContent.trim() === "") {
      resultTabHeader.style.pointerEvents = "none";
      resultTabHeader.style.opacity = "0.5";
    }
    return;
  }

  try {
    const list = await loadCacheList();
    // Сравниваем строки подключения (можно улучшить, вычисляя хэш)
    const hasCache = list.some((item) => item.sourceName === config.source && item.targetName === config.target);
    runBtn.disabled = !hasCache;

    if (!hasCache && (!resultContent || resultContent.trim() === "")) {
      resultTabHeader.style.pointerEvents = "none";
      resultTabHeader.style.opacity = "0.5";
    } else {
      resultTabHeader.style.pointerEvents = "auto";
      resultTabHeader.style.opacity = "1";
    }
  } catch (e) {
    console.error("Error checking cache:", e);
    runBtn.disabled = true;
  }
}

