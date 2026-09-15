import versionTxt from "../version.txt";

export function bakedProductVersion(): string | null {
  const trimmed = String(versionTxt).trim();
  return /^\d+\.\d+\.\d+$/.test(trimmed) ? trimmed : null;
}
