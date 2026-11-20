import { Unzip, UnzipInflate } from "fflate";
import { t } from "./i18n";
export const MAX_FILE = 1024 * 1024;
export const MAX_TOTAL = 32 * MAX_FILE;
export type ImportFile = { name: string; content: string };
export type ImportResult = { name: string; ok: boolean; error?: string };
export function validName(name: string) {
  return (
    name.endsWith(".info") &&
    !/[\\/]/.test(name) &&
    !Array.from(name).some((char) => char.charCodeAt(0) < 32) &&
    name !== ".info"
  );
}
export async function prepareImports(
  files: File[],
): Promise<{ files: ImportFile[]; results: ImportResult[] }> {
  const accepted: ImportFile[] = [],
    results: ImportResult[] = [];
  let total = 0,
    count = 0;
  const names = new Set<string>();
  const accept = (name: string, data: Uint8Array) => {
    if (!validName(name)) {
      results.push({ name, ok: false, error: t("imports.error.safeInfoOnly") });
      return;
    }
    if (names.has(name)) {
      results.push({ name, ok: false, error: t("imports.error.duplicate") });
      return;
    }
    names.add(name);
    try {
      accepted.push({ name, content: new TextDecoder("utf-8", { fatal: true }).decode(data) });
    } catch {
      results.push({ name, ok: false, error: t("imports.error.utf8") });
    }
  };
  if (files.reduce((sum, f) => sum + f.size, 0) > MAX_TOTAL)
    throw new Error(t("imports.error.sizeLimit"));
  for (const file of files) {
    if (file.name.toLowerCase().endsWith(".zip")) {
      let failure: string | null = null;
      let pending = 0;
      const unzip = new Unzip((entry) => {
        if (entry.name.endsWith("/")) return;
        count++;
        if (count > 100) throw new Error(t("imports.error.countLimit"));
        if (!validName(entry.name)) {
          results.push({ name: entry.name, ok: false, error: t("imports.error.nestedOrNonInfo") });
          return;
        }
        let size = 0;
        pending++;
        const chunks: Uint8Array[] = [];
        entry.ondata = (error, data, final) => {
          if (failure) return;
          if (error) {
            failure = t("imports.error.corrupt", { name: entry.name });
            return;
          }
          size += data.length;
          total += data.length;
          if (size > MAX_FILE || total > MAX_TOTAL) {
            failure = t("imports.error.unzipLimit");
            entry.terminate();
            return;
          }
          chunks.push(data);
          if (final) {
            pending--;
            const joined = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) {
              joined.set(chunk, offset);
              offset += chunk.length;
            }
            accept(entry.name, joined);
          }
        };
        entry.start();
      });
      unzip.register(UnzipInflate);
      const data = new Uint8Array(await file.arrayBuffer());
      // Small compressed chunks bound transient inflation allocations for hostile archives.
      for (let offset = 0; offset < data.length; offset += 4096) {
        unzip.push(data.subarray(offset, offset + 4096), offset + 4096 >= data.length);
        if (failure) throw new Error(failure);
      }
      if (pending) throw new Error(t("imports.error.emptyZip"));
    } else {
      count++;
      total += file.size;
      if (count > 100 || total > MAX_TOTAL) throw new Error(t("imports.error.batchLimit"));
      if (file.size > MAX_FILE) {
        results.push({ name: file.name, ok: false, error: t("imports.error.singleLimit") });
        continue;
      }
      accept(file.name, new Uint8Array(await file.arrayBuffer()));
    }
  }
  if (!count) throw new Error(t("imports.error.noFiles"));
  return { files: accepted, results };
}

// The endpoint is always explicit: a domestic refresh token cannot tell CLI from WorkBuddy.
export const REFRESH_PROFILES = [
  { value: "cn-work", label: "国内 WorkBuddy" },
  { value: "cn-cli", label: "国内 CodeBuddy CLI" },
  { value: "intl-work", label: "国际 WorkBuddy" },
  { value: "intl-cli", label: "国际 CodeBuddy CLI" },
] as const;
export const MAX_REFRESH_TOKENS = 50;
export const MAX_REFRESH_TOKEN_LENGTH = 8192;
export type RefreshProfile = (typeof REFRESH_PROFILES)[number]["value"];

/** Split textarea input into unique tokens, skipping blanks, comments and oversized lines. */
export function parseRefreshTokens(input: string): { tokens: string[]; rejected: number } {
  const seen = new Set<string>();
  const tokens: string[] = [];
  let rejected = 0;
  for (const raw of input.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.length > MAX_REFRESH_TOKEN_LENGTH) {
      rejected++;
      continue;
    }
    if (seen.has(line)) continue;
    seen.add(line);
    tokens.push(line);
  }
  return { tokens, rejected };
}
