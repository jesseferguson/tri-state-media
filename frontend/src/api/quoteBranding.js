import barcodeLabelsQuoteLogo from "../assets/barcode-labels-logo.png";
import triStateQuoteLogo from "../assets/tri-state-media-logo.png";
import { quoteCompanyKey, quoteCompanyOptions } from "./quoteCompanies";

const quoteBrandOverrides = {
  tri_state_media: {
    logo: triStateQuoteLogo,
    logoWidth: "538px",
    printLogoWidth: "5.45in",
    pdfLogoWidth: 330,
    pdfFallbackSubtitle: "Labels and media solutions",
    teamName: "Team Tri-State",
  },
  barcode_labels: {
    logo: barcodeLabelsQuoteLogo,
    logoWidth: "270px",
    printLogoWidth: "2.75in",
    pdfLogoWidth: 190,
    pdfFallbackSubtitle: "BarcodeLabels.com",
    teamName: "Barcode Labels",
  },
};

export const quoteCompanyBranding = quoteCompanyOptions.map((company) => ({
  ...company,
  key: company.value,
  ...quoteBrandOverrides[company.value],
}));

export function quoteCompanyForKey(value) {
  const key = quoteCompanyKey(value);
  return quoteCompanyBranding.find((company) => company.key === key) || quoteCompanyBranding[0];
}

export function quoteCompanyForQuote(quote = {}) {
  const record = quote || {};
  const salesQuote = record.form?.salesQuote || {};
  return quoteCompanyForKey(record.quoteCompany || salesQuote.quoteCompany || record.preparedByCompany);
}
