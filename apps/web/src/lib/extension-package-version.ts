import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const EXTENSION_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

export function readExtensionPackageVersion(): string {
  const packagePath = [
    join(process.cwd(), "../extension/package.json"),
    join(process.cwd(), "apps/extension/package.json"),
  ].find((candidate) => existsSync(candidate));
  if (!packagePath) {
    throw new Error("Extension package.json was not found.");
  }
  const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: unknown };
  if (typeof parsed.version !== "string" || !EXTENSION_VERSION_PATTERN.test(parsed.version)) {
    throw new Error("Extension package version must be semver X.Y.Z.");
  }
  return parsed.version;
}

export function extensionVersionDocument(version = readExtensionPackageVersion()) {
  return {
    name: "Annotated",
    version,
  };
}
