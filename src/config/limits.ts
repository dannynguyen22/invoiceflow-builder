// Configurable beta caps (PRD §01, §02).
export const LIMITS = {
  maxFilesPerBatch: 20,
  maxFileSizeMB: 20,
  acceptedExtensions: [".pdf", ".xml", ".jpg", ".jpeg", ".png"],
} as const;
