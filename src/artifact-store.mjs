import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const RECEIPT_ID = /^validation-[a-zA-Z0-9._-]{1,200}$/u;

export class MonitorArtifactStore {
  constructor(root) {
    if (typeof root !== "string" || !root) throw new TypeError("Monitor artifact directory is required");
    this.root = root;
  }

  async put(source) {
    if (typeof source !== "string" || !source || Buffer.byteLength(source, "utf8") > 65_536) {
      throw artifactError("invalid_source", "Monitor artifact must contain 1 to 65536 UTF-8 bytes");
    }
    const hash = sha256(source);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const destination = this.pathFor(hash);
    const temporary = join(this.root, `.${hash}.${randomUUID()}.tmp`);
    await writeFile(temporary, source, { encoding: "utf8", mode: 0o600, flag: "wx" });
    try {
      try { await link(temporary, destination); }
      catch (error) { if (error?.code !== "EEXIST") throw error; }
    } finally {
      await unlink(temporary).catch(() => {});
    }
    const verified = await this.read(hash);
    if (verified !== source) throw artifactError("hash_conflict", "Monitor artifact hash contains different content");
    return Object.freeze({ sha256: hash, bytes: Buffer.byteLength(source, "utf8") });
  }

  async read(hash) {
    validateHash(hash);
    let source;
    try { source = await readFile(this.pathFor(hash), "utf8"); }
    catch (error) {
      if (error?.code === "ENOENT") throw artifactError("artifact_missing", "Monitor artifact is missing");
      throw error;
    }
    if (sha256(source) !== hash) throw artifactError("artifact_tampered", "Monitor artifact integrity check failed");
    return source;
  }

  async putReceipt(receipt) {
    validateReceipt(receipt);
    await this.#ensureReceiptDirectory();
    const destination = this.receiptPathFor(receipt.validationId);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    await writeJson(temporary, receipt);
    try {
      await link(temporary, destination);
    } catch (error) {
      if (error?.code === "EEXIST") throw artifactError("receipt_conflict", "Monitor Bundle validation receipt already exists");
      throw error;
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }

  async updateReceipt(receipt) {
    validateReceipt(receipt);
    await this.#ensureReceiptDirectory();
    const destination = this.receiptPathFor(receipt.validationId);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    await writeJson(temporary, receipt);
    await rename(temporary, destination);
  }

  async readReceipt(validationId) {
    validateReceiptId(validationId);
    let value;
    try { value = JSON.parse(await readFile(this.receiptPathFor(validationId), "utf8")); }
    catch (error) {
      if (error?.code === "ENOENT") return null;
      if (error instanceof SyntaxError) throw artifactError("receipt_corrupt", "Monitor Bundle validation receipt is corrupt");
      throw error;
    }
    validateReceipt(value);
    return value;
  }

  async listReceipts() {
    await this.#ensureReceiptDirectory();
    const names = await readdir(join(this.root, "receipts"));
    const receipts = [];
    for (const name of names.filter(name => name.endsWith(".json")).sort()) {
      const validationId = name.slice(0, -5);
      validateReceiptId(validationId);
      const receipt = await this.readReceipt(validationId);
      if (receipt) receipts.push(receipt);
    }
    return receipts;
  }

  async listArtifactHashes() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const names = await readdir(this.root);
    return names.filter(name => /^[a-f0-9]{64}\.js$/u.test(name)).map(name => name.slice(0, -3)).sort();
  }

  async deleteReceipt(validationId) {
    validateReceiptId(validationId);
    try {
      await unlink(this.receiptPathFor(validationId));
      return true;
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
  }

  async deleteArtifact(hash) {
    validateHash(hash);
    try {
      await unlink(this.pathFor(hash));
      return true;
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
  }

  pathFor(hash) {
    validateHash(hash);
    return join(this.root, `${hash}.js`);
  }

  receiptPathFor(validationId) {
    validateReceiptId(validationId);
    return join(this.root, "receipts", `${validationId}.json`);
  }

  async #ensureReceiptDirectory() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await mkdir(join(this.root, "receipts"), { recursive: true, mode: 0o700 });
  }
}

async function writeJson(path, value) {
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, "utf8") > 262_144) throw artifactError("receipt_oversized", "Monitor Bundle validation receipt is too large");
  await writeFile(path, encoded, { encoding: "utf8", mode: 0o600, flag: "wx" });
}

function validateReceipt(receipt) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) throw artifactError("receipt_corrupt", "Monitor Bundle validation receipt is invalid");
  validateReceiptId(receipt.validationId);
  validateHash(receipt.artifact?.sha256);
  if (!Number.isSafeInteger(receipt.artifact?.bytes) || receipt.artifact.bytes < 1) throw artifactError("receipt_corrupt", "Monitor Bundle artifact metadata is invalid");
  if (!receipt.manifest || typeof receipt.manifest !== "object" || !receipt.authorization || typeof receipt.authorization !== "object") {
    throw artifactError("receipt_corrupt", "Monitor Bundle receipt metadata is invalid");
  }
  if (!Number.isFinite(Date.parse(receipt.expiresAt ?? "")) || !["validated", "installing", "installed"].includes(receipt.state)) {
    throw artifactError("receipt_corrupt", "Monitor Bundle receipt state is invalid");
  }
}

function validateReceiptId(validationId) {
  if (!RECEIPT_ID.test(validationId ?? "")) throw artifactError("invalid_receipt_id", "Monitor Bundle validation receipt id is invalid");
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function validateHash(hash) {
  if (!/^[a-f0-9]{64}$/u.test(hash ?? "")) throw artifactError("invalid_hash", "Monitor artifact hash is invalid");
}

function artifactError(errorClass, message) {
  return Object.assign(new Error(message), { name: "MonitorArtifactError", errorClass });
}
