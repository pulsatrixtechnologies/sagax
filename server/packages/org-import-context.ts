
export interface OrgImportContext {
  installId: string;
  ref: string;
  packageId: string;
  sha256: string;
  publisher: { organizationId: string; slug: string; name: string };
  adminOrigin: string;
  organizationId: string;
}
