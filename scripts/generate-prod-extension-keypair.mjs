import { generateKeyPairSync } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  chromeExtensionIdFromPublicKey,
  formatProdExtensionKeyReport,
} from "./prod-extension-key.mjs";

export function generateProdExtensionKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  const manifestKey = publicKey.toString("base64");
  return {
    manifestKey,
    privateKey,
    extensionId: chromeExtensionIdFromPublicKey(manifestKey),
  };
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  return process.argv[index + 1] ?? null;
}

async function main() {
  const writePublicKey = readArg("--public-key-out");
  const writePrivateKey = readArg("--private-key-out");

  if (!writePrivateKey) {
    console.error(
      [
        "This generates a NEW Production extension keypair and a NEW extension ID.",
        "Do not run it to refresh an ordinary zip build.",
        "Re-allowlist OAuth if you replace apps/extension/prod-extension-public-key.txt.",
        "",
        "Store the private key in the owner password manager as",
        "`Annotated Production Chrome extension PEM`. Do not commit it.",
        "The public key (Chrome manifest `key`) is not a secret.",
        "",
        "Usage:",
        "  node scripts/generate-prod-extension-keypair.mjs --private-key-out ./annotated-prod-extension.pem",
        "  node scripts/generate-prod-extension-keypair.mjs --private-key-out ./annotated-prod-extension.pem --public-key-out apps/extension/prod-extension-public-key.txt",
      ].join("\n"),
    );
    process.exit(2);
  }

  const { manifestKey, privateKey } = generateProdExtensionKeypair();
  await writeFile(resolve(writePrivateKey), privateKey, { mode: 0o600 });
  if (writePublicKey) {
    await writeFile(resolve(writePublicKey), `${manifestKey}\n`, { mode: 0o644 });
  }

  console.log(formatProdExtensionKeyReport(manifestKey));
  console.log(`Wrote private key to ${writePrivateKey} (not for git).`);
  if (writePublicKey) {
    console.log(`Wrote public key to ${writePublicKey}.`);
  } else {
    console.log("Public Chrome manifest key:");
    console.log(manifestKey);
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
