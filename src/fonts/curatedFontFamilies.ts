export const CURATED_LOCAL_FONT_FAMILIES = [
  "Arial",
  "Arial Black",
  "Baskerville",
  "Brush Script MT",
  "Courier New",
  "Garamond",
  "Georgia",
  "Helvetica",
  "Impact",
  "Lucida Console",
  "Palatino",
  "Tahoma",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
  "system-ui",
  "sans-serif",
  "serif",
  "monospace",
] as const;

export function normalizeFontFamilyName(value: string): string {
  return value.trim().toLowerCase();
}
