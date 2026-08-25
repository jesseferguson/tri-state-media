export const materialTypePageKeys = new Set([
  "material-faces",
  "material-liners",
  "material-adhesives",
  "material-silicone",
  "material-coatings",
]);

export const materialFormPageKeys = new Set([
  "materials",
  "material-coated-stock",
  "material-faces",
  "material-liners",
  "material-adhesives",
  "material-silicone",
  "material-coatings",
  "material-supplier-options",
  "raw-materials",
]);

export const toolingConfigFormPageKeys = new Set([
  "recipes",
  "recipe-options",
  "recipe-tools",
]);

export const toolingItemPageKeys = new Set([
  "flex-dies",
  "rotary-dies",
  "mags",
  "perf-cylinders",
  "perf-blade-setups",
]);

export const materialOwnerTabs = [
  { key: "tri_state", label: "Tri-State Media Materials" },
  { key: "other", label: "Other Materials" },
];

export function isTriStateMaterial(row) {
  return /tri\s*-?\s*state\s+media/i.test(String(row?.company || ""));
}
