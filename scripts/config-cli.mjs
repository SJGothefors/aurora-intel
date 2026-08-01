#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultsPath = path.join(root, "config", "app.defaults.json");
const localPath = path.join(root, "config", "app.local.json");

function readJson(file, required) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (!required && error?.code === "ENOENT") return {};
    throw new Error(`Cannot read ${path.relative(root, file)}: ${error.message}`);
  }
}

function merge(base, overlay) {
  const result = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    if (value && typeof value === "object" && !Array.isArray(value) && base[key] && typeof base[key] === "object" && !Array.isArray(base[key])) {
      result[key] = merge(base[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function validate(config) {
  if (config.bindAddress !== "127.0.0.1") throw new Error("bindAddress is immutable and must be 127.0.0.1");
  for (const key of ["appPort", "llmPort"]) {
    if (!Number.isInteger(config[key]) || config[key] < 1 || config[key] > 65535) throw new Error(`${key} must be an integer from 1 to 65535`);
  }
  if (config.appPort === config.llmPort) throw new Error("appPort and llmPort must differ");
  if (typeof config.modelPath !== "string" || !config.modelPath.toLowerCase().endsWith(".gguf")) throw new Error("modelPath must name a .gguf file");
  const modelDir = path.resolve(root, "llm", "models");
  const model = path.resolve(root, config.modelPath);
  if (model !== modelDir && !model.startsWith(`${modelDir}${path.sep}`)) throw new Error("modelPath must stay inside llm/models");
  return config;
}

function getPath(value, dotted) {
  return dotted.split(".").reduce((current, key) => current?.[key], value);
}

try {
  const defaultsOnly = process.env.AURORA_CONFIG_DEFAULTS_ONLY === "1";
  const config = validate(merge(readJson(defaultsPath, true), defaultsOnly ? {} : readJson(localPath, false)));
  const [command = "json", key] = process.argv.slice(2);
  if (command === "json") process.stdout.write(`${JSON.stringify(config)}\n`);
  else if (command === "model") process.stdout.write(`${path.resolve(root, config.modelPath)}\n`);
  else if (command === "get" && key) {
    const value = getPath(config, key);
    if (value === undefined) throw new Error(`Unknown configuration key: ${key}`);
    process.stdout.write(typeof value === "object" ? `${JSON.stringify(value)}\n` : `${value}\n`);
  } else throw new Error("Usage: config-cli.mjs [json|model|get KEY]");
} catch (error) {
  console.error(`FEL / ERROR: ${error.message}`);
  process.exit(1);
}
