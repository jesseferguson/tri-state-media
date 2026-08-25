export const defaultQuoteCompany = "tri_state_media";

export const quoteCompanyOptions = [
  { value: "tri_state_media", label: "Tri-State Media" },
  { value: "barcode_labels", label: "Barcode Labels" },
];

export function quoteCompanyKey(value) {
  const cleanValue = String(value || "").trim().toLowerCase();
  return quoteCompanyOptions.some((company) => company.value === cleanValue) ? cleanValue : defaultQuoteCompany;
}

export function quoteCompanyLabel(value) {
  return quoteCompanyOptions.find((company) => company.value === quoteCompanyKey(value))?.label || "Tri-State Media";
}
