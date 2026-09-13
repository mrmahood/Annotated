export const LEGAL_PATHS = {
  center: "/legal",
  privacy: "/privacy",
  terms: "/terms",
} as const;

export const LEGAL_EFFECTIVE_ON = "August 30, 2026";
export const LEGAL_UPDATED_ON = "August 30, 2026";

export const LEGAL_OPERATOR = {
  person: "Matt Mahood",
  company: "The CB & Cooper Limited Liability Company",
  jurisdiction: "a South Carolina limited liability company",
  street: "120 Academy Street, Suite 102-105",
  locality: "Fort Mill, SC 29715",
  country: "United States",
  email: "matt@cbandcoop.com",
} as const;

export type LegalSectionNav = {
  id: string;
  number: string;
  title: string;
};

export const PRIVACY_SECTIONS: readonly LegalSectionNav[] = [
  { id: "scope", number: "01", title: "Scope" },
  { id: "who-operates-annotated", number: "02", title: "Who operates Annotated" },
  { id: "information-we-collect", number: "03", title: "Information we collect" },
  { id: "chrome-extension", number: "04", title: "Chrome extension and active-page behavior" },
  { id: "sources-of-information", number: "05", title: "Sources of information" },
  { id: "how-we-use-information", number: "06", title: "How we use information" },
  { id: "legal-bases", number: "07", title: "Legal bases for processing" },
  { id: "public-information", number: "08", title: "Public information" },
  { id: "ai-assisted-processing", number: "09", title: "AI-assisted excerpt processing" },
  { id: "service-providers", number: "10", title: "Service providers and disclosures" },
  { id: "no-sale", number: "11", title: "No sale, targeted advertising, or unauthorized marketing" },
  { id: "cookies", number: "12", title: "Cookies and browser storage" },
  { id: "retention", number: "13", title: "Retention" },
  { id: "security", number: "14", title: "Security" },
  { id: "international-transfers", number: "15", title: "International data transfers" },
  { id: "privacy-rights", number: "16", title: "Privacy rights and requests" },
  { id: "us-state-disclosures", number: "17", title: "United States state privacy disclosures" },
  { id: "eea-uk", number: "18", title: "EEA, United Kingdom, Switzerland, and similar jurisdictions" },
  { id: "children", number: "19", title: "Children" },
  { id: "third-party-sites", number: "20", title: "Third-party websites and identity providers" },
  { id: "policy-changes", number: "21", title: "Changes to this policy" },
  { id: "contact", number: "22", title: "Contact information" },
];

export const TERMS_SECTIONS: readonly LegalSectionNav[] = [
  { id: "agreement", number: "01", title: "Agreement to the terms" },
  { id: "description", number: "02", title: "Description and scope of the service" },
  { id: "beta", number: "03", title: "Beta status and service changes" },
  { id: "eligibility", number: "04", title: "Eligibility and age requirement" },
  { id: "accounts", number: "05", title: "Accounts and account security" },
  { id: "user-content", number: "06", title: "User content" },
  { id: "license", number: "07", title: "License granted to Annotated" },
  { id: "public-content", number: "08", title: "Public content and attribution" },
  { id: "source-materials", number: "09", title: "Source materials and media excerpts" },
  { id: "acceptable-use", number: "10", title: "Acceptable use" },
  { id: "copyright", number: "11", title: "Copyright complaints" },
  { id: "moderation", number: "12", title: "Moderation and enforcement" },
  { id: "termination", number: "13", title: "Suspension and termination" },
  { id: "third-parties", number: "14", title: "Third-party services and source websites" },
  { id: "privacy", number: "15", title: "Privacy" },
  { id: "feedback", number: "16", title: "Feedback" },
  { id: "disclaimers", number: "17", title: "Disclaimers" },
  { id: "liability", number: "18", title: "Limitation of liability" },
  { id: "indemnification", number: "19", title: "Indemnification" },
  { id: "governing-law", number: "20", title: "Governing law and venue" },
  { id: "changes", number: "21", title: "Changes to the terms" },
  { id: "general", number: "22", title: "General provisions" },
  { id: "contact", number: "23", title: "Contact information" },
];
