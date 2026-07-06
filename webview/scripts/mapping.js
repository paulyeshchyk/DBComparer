
export function initMappingTable() {
  const mapping = loadMappingFromStorage();
  const tbody = document.getElementById("mappingBody");
  tbody.innerHTML = "";
  const entries = Object.entries(mapping);
  if (entries.length === 0) addMappingRow("", "");
  else entries.forEach(([source, target]) => addMappingRow(source, target));
}

export function getMappingFromTable() {
  const rows = document.querySelectorAll("#mappingBody tr");
  const mapping = {};
  rows.forEach((row) => {
    const sourceInput = row.querySelector(".mapping-source");
    const targetInput = row.querySelector(".mapping-target");
    if (sourceInput && targetInput) {
      const source = sourceInput.value.trim();
      const target = targetInput.value.trim();
      if (source && target) mapping[source] = target;
    }
  });
  return mapping;
}

export function saveMappingToStorage() {
  const mapping = getMappingFromTable();
  localStorage.setItem("dbCompareMapping", JSON.stringify(mapping));
}

export function loadMappingFromStorage() {
  const data = localStorage.getItem("dbCompareMapping");
  if (data) {
    try {
      return JSON.parse(data);
    } catch {
      return {};
    }
  }
  return {};
}
// ---------- Управление таблицей маппинга ----------

export function addMappingRow(source = "", target = "") {
  const tbody = document.getElementById("mappingBody");
  const row = document.createElement("tr");
  row.innerHTML = `
    <td><input type="text" class="mapping-source" value="${source}" placeholder="${window.i18n.t('mapping.schema.source')}" style="width:100%;"></td>
    <td><input type="text" class="mapping-target" value="${target}" placeholder="${window.i18n.t('mapping.schema.target')}" style="width:100%;"></td>
    <td><button type="button" class="removeMappingRow" style="background:transparent; border:none; color:var(--vscode-errorForeground); cursor:pointer;">✕</button></td>
  `;
  tbody.appendChild(row);
  const removeBtn = row.querySelector(".removeMappingRow");
  removeBtn.addEventListener("click", function () {
    if (tbody.children.length > 1) {
      row.remove();
      saveMappingToStorage();
    } else {
      alert("Должна остаться хотя бы одна строка (можно оставить пустые поля).");
    }
  });
  const inputs = row.querySelectorAll("input");
  inputs.forEach((input) => input.addEventListener("input", saveMappingToStorage));
  saveMappingToStorage();
}

