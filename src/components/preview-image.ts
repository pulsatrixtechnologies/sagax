export interface PreviewImage {
  src: string;
  name: string;
  /** Same-origin images can be downloaded directly. */
  downloadUrl?: string;
  /** A portable filename chosen independently from the visible label. */
  downloadName?: string;
  /** Authored remote images keep an explicit way to open their source. */
  openUrl?: string;
}
