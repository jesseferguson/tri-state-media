export function asArray(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  return payload.results ?? [];
}

export function valueAt(record, key) {
  if (!record) return "";
  if (key in record) return record[key];
  const detailKey = `${key}_details`;
  if (record[detailKey]) return getRecordTitle(record[detailKey]);
  return "";
}

export function formatInches(value) {
  if (value === null || value === undefined || value === "") return "--";
  const number = Number(value);
  if (Number.isNaN(number)) return String(value);
  return number.toFixed(4).replace(/0+$/, "").replace(/\.$/, "") + '"';
}

export function labelize(value) {
  if (value === null || value === undefined || value === "") return "--";
  return String(value).replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getRecordTitle(record) {
  if (!record) return "--";
  return (
    record.name ||
    record.ticket_number ||
    record.job_name ||
    record.product_name ||
    record.title ||
    record.label ||
    record.sku ||
    record.code ||
    record.serial_number ||
    record.tool_number ||
    record.recipe_option_name ||
    record.recipe_name ||
    record.press_name ||
    record.tool_label ||
    `#${record.id ?? ""}`
  );
}

export function getNestedTitle(record, field) {
  return record?.[`${field}_name`] || record?.[`${field}_label`] || getRecordTitle(record?.[`${field}_details`]);
}

export function formatCell(record, key) {
  const value = valueAt(record, key);
  if (value === true) return "Yes";
  if (value === false) return "No";
  if (value === null || value === undefined || value === "") return getNestedTitle(record, key) || "--";
  if (key.includes("inch") || key === "repeat_inches" || key === "web_width_inches") return formatInches(value);
  if (typeof value === "object") return getRecordTitle(value);
  return labelize(value);
}

export function includesText(value, needle) {
  if (needle === "" || needle === null || needle === undefined) return true;
  return String(value ?? "").toLowerCase().includes(String(needle).toLowerCase());
}

export function eqLoose(value, expected) {
  if (expected === "" || expected === null || expected === undefined) return true;
  return String(value ?? "").toLowerCase() === String(expected).toLowerCase();
}

export function numberNear(value, target, tolerance = 0.01) {
  if (target === "" || target === null || target === undefined) return true;
  const a = Number(value);
  const b = Number(target);
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return Math.abs(a - b) <= tolerance;
}

export function groupBy(items, getKey) {
  return items.reduce((acc, item) => {
    const key = getKey(item) || "Unassigned";
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});
}
