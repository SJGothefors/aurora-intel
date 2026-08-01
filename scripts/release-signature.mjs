#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function usage() {
  console.error("Usage:\n  release-signature.mjs sign ARCHIVE EXPECTED_SHA256 PRIVATE_KEY SIG_JSON PUBLIC_KEY\n  release-signature.mjs verify ARCHIVE SIG_JSON PUBLIC_KEY");
  process.exit(2);
}

function sha256File(filename) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filename);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function publicFingerprint(publicKey) {
  const der = publicKey.export({ type: "spki", format: "der" });
  return crypto.createHash("sha256").update(der).digest("hex");
}

function loadPrivateKey(filename) {
  const pem = fs.readFileSync(filename);
  const passphrase = process.env.AURORA_SIGNING_KEY_PASSPHRASE;
  return crypto.createPrivateKey(passphrase ? { key: pem, format: "pem", passphrase } : { key: pem, format: "pem" });
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === "sign") {
    if (args.length !== 5) usage();
    const [archiveArg, expectedSha, privateKeyArg, signatureArg, publicKeyArg] = args;
    if (!/^[0-9a-f]{64}$/.test(expectedSha)) throw new Error("Expected SHA-256 must be 64 lowercase hexadecimal characters");
    const archive = path.resolve(archiveArg);
    const actualSha = await sha256File(archive);
    if (actualSha !== expectedSha) throw new Error("Archive changed after its transport digest was computed");
    const privateKey = loadPrivateKey(path.resolve(privateKeyArg));
    if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("Signing key must be an Ed25519 private key");
    const publicKey = crypto.createPublicKey(privateKey);
    const digestBytes = Buffer.from(actualSha, "hex");
    const signature = crypto.sign(null, digestBytes, privateKey);
    if (!crypto.verify(null, digestBytes, publicKey, signature)) throw new Error("Generated signature failed self-verification");
    const record = {
      version: 1,
      algorithm: "Ed25519-over-SHA256",
      archive: path.basename(archive),
      sha256: actualSha,
      publicKeySha256: publicFingerprint(publicKey),
      signatureBase64: signature.toString("base64"),
    };
    fs.writeFileSync(path.resolve(signatureArg), `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o644 });
    fs.writeFileSync(path.resolve(publicKeyArg), publicKey.export({ type: "spki", format: "pem" }), { mode: 0o644 });
    console.log(`Detached signature written. Public-key SHA-256: ${record.publicKeySha256}`);
  } else if (command === "verify") {
    if (args.length !== 3) usage();
    const [archiveArg, signatureArg, publicKeyArg] = args;
    const archive = path.resolve(archiveArg);
    const record = JSON.parse(fs.readFileSync(path.resolve(signatureArg), "utf8"));
    if (record?.version !== 1 || record?.algorithm !== "Ed25519-over-SHA256" || !/^[0-9a-f]{64}$/.test(record?.sha256 ?? "") || typeof record?.signatureBase64 !== "string") throw new Error("Invalid detached-signature record");
    if (record.archive !== path.basename(archive)) throw new Error("Signature record names a different archive");
    const actualSha = await sha256File(archive);
    if (actualSha !== record.sha256) throw new Error("Archive SHA-256 does not match the signed digest");
    const publicKey = crypto.createPublicKey(fs.readFileSync(path.resolve(publicKeyArg)));
    if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("Verification key must be Ed25519");
    if (publicFingerprint(publicKey) !== record.publicKeySha256) throw new Error("Public-key fingerprint does not match the signature record");
    const valid = crypto.verify(null, Buffer.from(actualSha, "hex"), publicKey, Buffer.from(record.signatureBase64, "base64"));
    if (!valid) throw new Error("Detached signature is invalid");
    console.log(`Detached signature: OK (${record.publicKeySha256})`);
  } else {
    usage();
  }
} catch (error) {
  console.error(`FEL / ERROR: Release signature operation failed: ${error.message}`);
  process.exit(1);
}
