// webview/src/filters.js

const STORAGE_KEY_INCLUDE = 'dbCompareIncludeFilters';
const STORAGE_KEY_EXCLUDE = 'dbCompareExcludeFilters';

// ---------- Загрузка/сохранение ----------
export function loadIncludeFilters() {
  const data = localStorage.getItem(STORAGE_KEY_INCLUDE);
  if (data) {
    try { return JSON.parse(data); } catch { return ['*']; }
  }
  return ['*'];
}

export function loadExcludeFilters() {
  const data = localStorage.getItem(STORAGE_KEY_EXCLUDE);
  if (data) {
    try { return JSON.parse(data); } catch { return []; }
  }
  return [];
}

export function saveIncludeFilters(filters) {
  localStorage.setItem(STORAGE_KEY_INCLUDE, JSON.stringify(filters));
}

export function saveExcludeFilters(filters) {
  localStorage.setItem(STORAGE_KEY_EXCLUDE, JSON.stringify(filters));
}

// ---------- Рендеринг таблиц ----------
function renderIncludeFilters() {
  const filters = loadIncludeFilters();
  const tbody = document.getElementById('includeFiltersBody');
  tbody.innerHTML = '';
  // Всегда добавляем строку "*" (неудаляемую)
  const starRow = document.createElement('tr');
  starRow.dataset.filter = '*';
  starRow.innerHTML = `
        <td><input type="text" class="filter-pattern" value="*" readonly disabled style="background:var(--vscode-input-background); color:var(--vscode-disabledForeground);"></td>
        <td><button class="remove-filter" disabled style="opacity:0.3;">✕</button></td>
    `;
  tbody.appendChild(starRow);

  // Добавляем остальные фильтры (кроме "*")
  filters.filter(f => f !== '*').forEach(pattern => {
    addIncludeFilterRow(pattern);
  });
}

function addIncludeFilterRow(pattern = '') {
  const tbody = document.getElementById('includeFiltersBody');
  const row = document.createElement('tr');
  row.innerHTML = `
        <td><input type="text" class="filter-pattern" value="${pattern}" placeholder="регулярка (например, ^tbl_)"></td>
        <td><button class="remove-filter">✕</button></td>
    `;
  tbody.appendChild(row);

  const input = row.querySelector('.filter-pattern');
  const removeBtn = row.querySelector('.remove-filter');
  removeBtn.addEventListener('click', () => {
    // Не удаляем, если это единственная строка (кроме "*")? Можно удалять всегда, кроме "*"
    if (row.dataset.filter === '*') return;
    row.remove();
    saveIncludeFiltersFromDOM();
  });
  input.addEventListener('input', saveIncludeFiltersFromDOM);
}

function renderExcludeFilters() {
  const filters = loadExcludeFilters();
  const tbody = document.getElementById('excludeFiltersBody');
  tbody.innerHTML = '';
  filters.forEach(pattern => {
    addExcludeFilterRow(pattern);
  });
}

function addExcludeFilterRow(pattern = '') {
  const tbody = document.getElementById('excludeFiltersBody');
  const row = document.createElement('tr');
  row.innerHTML = `
        <td><input type="text" class="filter-pattern" value="${pattern}" placeholder="регулярка (например, ^tmp_)"></td>
        <td><button class="remove-filter">✕</button></td>
    `;
  tbody.appendChild(row);

  const input = row.querySelector('.filter-pattern');
  const removeBtn = row.querySelector('.remove-filter');
  removeBtn.addEventListener('click', () => {
    row.remove();
    saveExcludeFiltersFromDOM();
  });
  input.addEventListener('input', saveExcludeFiltersFromDOM);
}

function saveIncludeFiltersFromDOM() {
  const inputs = document.querySelectorAll('#includeFiltersBody .filter-pattern');
  const patterns = [];
  inputs.forEach(input => {
    const val = input.value.trim();
    if (val && val !== '*') patterns.push(val);
  });
  // Всегда сохраняем "*" как первый элемент (если есть)
  const starExists = document.querySelector('#includeFiltersBody tr[data-filter="*"]');
  if (starExists) {
    // Если есть только "*", то сохраняем ['*']
    if (patterns.length === 0) {
      saveIncludeFilters(['*']);
    } else {
      saveIncludeFilters(['*', ...patterns]);
    }
  } else {
    saveIncludeFilters(patterns);
  }
}

function saveExcludeFiltersFromDOM() {
  const inputs = document.querySelectorAll('#excludeFiltersBody .filter-pattern');
  const patterns = [];
  inputs.forEach(input => {
    const val = input.value.trim();
    if (val) patterns.push(val);
  });
  saveExcludeFilters(patterns);
}

// ---------- Инициализация ----------
export function initFilters() {
  renderIncludeFilters();
  renderExcludeFilters();

  document.getElementById('addIncludeFilter').addEventListener('click', () => {
    addIncludeFilterRow('');
  });
  document.getElementById('addExcludeFilter').addEventListener('click', () => {
    addExcludeFilterRow('');
  });
}

// ---------- Получение фильтров для отправки ----------
export function getFilters() {
  return {
    include: loadIncludeFilters(),
    exclude: loadExcludeFilters()
  };
}