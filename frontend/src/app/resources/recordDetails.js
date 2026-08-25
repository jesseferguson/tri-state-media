import { formatCell, getRecordTitle } from "../../lib/format";

function labelForField(resource, key) {
  const friendlyLabels = {
    recipe: "Label Layout",
    recipe_name: "Label Layout",
    recipe_option: "Press Setup Option",
    recipe_option_name: "Press Setup Option",
  };
  if (friendlyLabels[key]) return friendlyLabels[key];
  const field = (resource.fields ?? []).find((item) => item.name === key);
  return field?.label ?? key.replace(/_/g, " ");
}

function getDetailKeys(resource, record) {
  const fieldNames = (resource.fields ?? []).map((field) => field.name);
  const seen = new Set();

  return [...(resource.columns ?? []), ...fieldNames, ...Object.keys(record ?? {})].filter((key) => {
    if (seen.has(key) || key === "id" || key.endsWith("_details")) return false;
    const value = record?.[key];
    if (value === undefined) return false;
    if (Array.isArray(value) && !value.length) return false;
    if (value && typeof value === "object" && !Array.isArray(value)) return false;
    if ((key.endsWith("_name") || key.endsWith("_label")) && fieldNames.includes(key.replace(/_(name|label)$/, ""))) return false;
    seen.add(key);
    return true;
  });
}

function detailValue(record, key) {
  const relationText = record?.[`${key}_name`] ?? record?.[`${key}_label`] ?? record?.[`${key}_number`] ?? record?.[`${key}_serial`];
  if (relationText && (record?.[key] === null || record?.[key] === undefined || typeof record?.[key] === "number")) return String(relationText);

  const value = record?.[key];
  if (Array.isArray(value)) {
    return value.length ? value.map((item) => typeof item === "object" ? getRecordTitle(item) : item).join(", ") : "--";
  }
  return formatCell(record, key);
}

export { detailValue, getDetailKeys, labelForField };
