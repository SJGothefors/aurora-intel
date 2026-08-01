#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? ".");
const output = path.resolve(process.argv[3] ?? path.join(root, "docs", "release", "aurora-intel.cdx.json"));
const packageLockPath = path.join(root, "package-lock.json");
const versionsLockPath = path.join(root, "config", "versions.lock");

function readJson(filename) {
  return JSON.parse(fs.readFileSync(filename, "utf8"));
}

function sha256File(filename) {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(filename, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
    }
  } finally { fs.closeSync(descriptor); }
  return hash.digest("hex");
}

function packageName(lockPath) {
  const marker = "node_modules/";
  const index = lockPath.lastIndexOf(marker);
  if (index < 0) throw new Error(`Unsupported package-lock path: ${lockPath}`);
  return lockPath.slice(index + marker.length);
}

function npmPurl(name, version) {
  const encodedVersion = encodeURIComponent(version);
  if (name.startsWith("@")) {
    const [scope, leaf] = name.split("/");
    return `pkg:npm/${encodeURIComponent(scope)}/${encodeURIComponent(leaf)}@${encodedVersion}`;
  }
  return `pkg:npm/${encodeURIComponent(name)}@${encodedVersion}`;
}

function sriHash(integrity) {
  if (typeof integrity !== "string") return [];
  const match = /^(sha256|sha384|sha512)-([A-Za-z0-9+/=]+)$/.exec(integrity.trim());
  if (!match) return [];
  const algorithm = { sha256: "SHA-256", sha384: "SHA-384", sha512: "SHA-512" }[match[1]];
  return [{ alg: algorithm, content: Buffer.from(match[2], "base64").toString("hex") }];
}

function licenseChoice(value) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const license = value.trim();
  return /^[A-Za-z0-9.+-]+$/.test(license)
    ? [{ license: { id: license } }]
    : [{ expression: license }];
}

function property(name, value) {
  return { name, value: String(value) };
}

function refForPackage(lockPath) {
  return `urn:aurora:npm:${crypto.createHash("sha256").update(lockPath).digest("hex").slice(0, 24)}`;
}

function resolveDependencyPath(packages, parentPath, dependencyName) {
  let search = parentPath;
  for (;;) {
    const candidate = search ? `${search}/node_modules/${dependencyName}` : `node_modules/${dependencyName}`;
    if (packages[candidate]) return candidate;
    if (!search) return null;
    const marker = search.lastIndexOf("/node_modules/");
    search = marker >= 0 ? search.slice(0, marker) : "";
  }
}

function artifactVersion(kind, url, filename) {
  if (kind === "node") return /node-v([0-9.]+)/.exec(filename)?.[1] ?? "unknown";
  if (kind === "llama") return /\/download\/([^/]+)\//.exec(url)?.[1] ?? "unknown";
  if (kind === "model") return /\/resolve\/([0-9a-f]{40})\//i.exec(url)?.[1] ?? "unknown";
  return "unknown";
}

function parseArtifactLock(text) {
  const rows = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const fields = line.split("|");
    if (fields.length !== 7) throw new Error(`Invalid config/versions.lock entry: ${line}`);
    const [id, platform, kind, filename, url, sha256, destination] = fields;
    if (!/^[0-9a-f]{64}$/i.test(sha256)) throw new Error(`Invalid artifact SHA-256: ${id}`);
    if (!destination || path.isAbsolute(destination) || destination.split(/[\\/]/).includes("..")) throw new Error(`Unsafe artifact destination: ${id}`);
    rows.push({ id, platform, kind, filename, url, sha256: sha256.toLowerCase(), destination });
  }
  return rows;
}

const packageLock = readJson(packageLockPath);
if (packageLock.lockfileVersion !== 3 || !packageLock.packages?.[""]) throw new Error("package-lock.json must use lockfileVersion 3 and contain a root package");
const rootPackage = packageLock.packages[""];
const rootVersion = rootPackage.version ?? packageLock.version;
const rootName = rootPackage.name ?? packageLock.name;
if (!rootName || !rootVersion) throw new Error("package-lock root name/version is missing");

const packageEntries = Object.entries(packageLock.packages)
  .filter(([lockPath]) => lockPath !== "")
  .sort(([left], [right]) => left.localeCompare(right, "en"));
const components = [];
const packageRefs = new Map();

for (const [lockPath, record] of packageEntries) {
  const name = packageName(lockPath);
  if (!record.version) throw new Error(`Package version is missing: ${lockPath}`);
  const purl = npmPurl(name, record.version);
  const bomRef = refForPackage(lockPath);
  packageRefs.set(lockPath, bomRef);
  const component = {
    type: "library",
    "bom-ref": bomRef,
    name,
    version: record.version,
    purl,
    properties: [
      property("aurora:npm:lock-path", lockPath),
      property("aurora:npm:development", Boolean(record.dev)),
      property("aurora:npm:optional", Boolean(record.optional))
    ]
  };
  const hashes = sriHash(record.integrity);
  if (hashes.length) component.hashes = hashes;
  const licenses = licenseChoice(record.license);
  if (licenses) component.licenses = licenses;
  if (record.resolved) component.externalReferences = [{ type: "distribution", url: record.resolved }];
  components.push(component);
}

const artifactRows = parseArtifactLock(fs.readFileSync(versionsLockPath, "utf8"));
const artifactRefs = [];
for (const artifact of artifactRows) {
  const absolute = path.join(root, artifact.destination);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw new Error(`Pinned artifact is missing while creating SBOM: ${artifact.destination}`);
  const bomRef = `urn:aurora:artifact:${artifact.id}`;
  artifactRefs.push(bomRef);
  components.push({
    type: artifact.kind === "model" ? "machine-learning-model" : artifact.kind === "node" ? "framework" : "application",
    "bom-ref": bomRef,
    name: artifact.id,
    version: artifactVersion(artifact.kind, artifact.url, artifact.filename),
    hashes: [{ alg: "SHA-256", content: artifact.sha256 }],
    externalReferences: [{ type: "distribution", url: artifact.url }],
    properties: [
      property("aurora:artifact:kind", artifact.kind),
      property("aurora:artifact:platform", artifact.platform),
      property("aurora:artifact:filename", artifact.filename),
      property("aurora:artifact:destination", artifact.destination),
      property("aurora:artifact:size-bytes", fs.statSync(absolute).size)
    ]
  });
}

const applicationRef = npmPurl(rootName, rootVersion);
const rootDependencyNames = {
  ...(rootPackage.dependencies ?? {}),
  ...(rootPackage.optionalDependencies ?? {}),
  ...(rootPackage.devDependencies ?? {})
};
const dependencies = [{
  ref: applicationRef,
  dependsOn: [
    ...Object.keys(rootDependencyNames)
      .map((name) => resolveDependencyPath(packageLock.packages, "", name))
      .filter(Boolean)
      .map((lockPath) => packageRefs.get(lockPath)),
    ...artifactRefs
  ].sort()
}];

for (const [lockPath, record] of packageEntries) {
  const dependencyNames = {
    ...(record.dependencies ?? {}),
    ...(record.optionalDependencies ?? {}),
    ...(record.peerDependencies ?? {})
  };
  dependencies.push({
    ref: packageRefs.get(lockPath),
    dependsOn: [...new Set(Object.keys(dependencyNames)
      .map((name) => resolveDependencyPath(packageLock.packages, lockPath, name))
      .filter(Boolean)
      .map((candidate) => packageRefs.get(candidate)))].sort()
  });
}
for (const ref of artifactRefs) dependencies.push({ ref, dependsOn: [] });

const bom = {
  $schema: "https://cyclonedx.org/schema/bom-1.5.schema.json",
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  serialNumber: `urn:uuid:${crypto.randomUUID()}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    tools: [{ vendor: "Aurora Intel", name: "scripts/make-sbom.mjs", version: rootVersion }],
    component: { type: "application", "bom-ref": applicationRef, name: rootName, version: rootVersion, purl: applicationRef },
    properties: [
      property("aurora:source:package-lock-sha256", sha256File(packageLockPath)),
      property("aurora:source:versions-lock-sha256", sha256File(versionsLockPath)),
      property("aurora:inventory:npm-package-count", packageEntries.length),
      property("aurora:inventory:pinned-artifact-count", artifactRows.length),
      property("aurora:inventory:scope", "full-package-lock-plus-pinned-release-artifacts")
    ]
  },
  components: components.sort((left, right) => left["bom-ref"].localeCompare(right["bom-ref"], "en")),
  dependencies: dependencies.sort((left, right) => left.ref.localeCompare(right.ref, "en"))
};

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(bom, null, 2)}\n`, { encoding: "utf8", mode: 0o644 });
console.log(`Wrote CycloneDX 1.5 SBOM with ${packageEntries.length} npm packages and ${artifactRows.length} pinned artifacts: ${path.relative(root, output)}`);
