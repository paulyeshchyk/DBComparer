import { getMappingFromTable } from "./mapping";

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========
export function getDisplayName(schema, name, showSchema) {
  return showSchema ? `${schema}.${name}` : name;
}export function getCurrentConfig() {
  return {
    source: document.getElementById("source").value.trim(),
    target: document.getElementById("target").value.trim(),
    normalizeTypes: document.getElementById("normalizeTypes").checked,
    normalizeSchemaEnabled: document.getElementById("normalizeSchemaEnabled").checked,
    ignoreCase: document.getElementById("ignoreCase").checked,
    hideIdentical: document.getElementById("hideIdentical").checked,
    viewMode: document.querySelector('input[name="viewMode"]:checked')?.value || "detailed",
    normalizeSchema: getMappingFromTable(),
  };
}

