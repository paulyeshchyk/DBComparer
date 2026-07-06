// ---------- Управление вкладками ----------

export function switchTab(tabId) {
  document.querySelectorAll(".tab-content").forEach((el) => el.classList.remove("active"));
  document.getElementById("tab-" + tabId).classList.add("active");
  document.querySelectorAll(".tab-header").forEach((el) => el.classList.remove("active"));
  document.querySelector(`.tab-header[data-tab="${tabId}"]`).classList.add("active");
}// ---------- Блокировка/разблокировка контролов ----------

export function setSettingsEnabled(enabled) {
  const tabs = document.querySelectorAll(".tab-content");
  tabs.forEach((el) => {
    if (enabled) {
      el.classList.remove("disabled");
    } else {
      el.classList.add("disabled");
    }
  });

  const settingsTab = document.getElementById("tab-settings");
  const inputs = settingsTab.querySelectorAll("input, textarea, button");
  inputs.forEach((el) => {
    el.disabled = !enabled;
  });
  const mappingButtons = settingsTab.querySelectorAll("#addMappingRow, .removeMappingRow");
  mappingButtons.forEach((el) => (el.disabled = !enabled));

  if (!enabled) {
    settingsTab.classList.add("disabled");
  } else {
    settingsTab.classList.remove("disabled");
  }
}

