import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const APP_SECRET = process.env.APP_SECRET || "passpad-development-secret-change-me";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const ROOMS_DIR = path.join(DATA_DIR, "rooms");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 25 * 1024 * 1024);
const MAX_BATCH_UPLOAD_BYTES = Number(process.env.MAX_BATCH_UPLOAD_BYTES || 100 * 1024 * 1024);
const MAX_UPLOAD_FILES = Number(process.env.MAX_UPLOAD_FILES || 10);

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml"],
  [".pdf", "application/pdf"],
  [".txt", "text/plain; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".csv", "text/csv; charset=utf-8"],
  [".doc", "application/msword"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".ppt", "application/vnd.ms-powerpoint"],
  [".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  [".xls", "application/vnd.ms-excel"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [".zip", "application/zip"]
]);

const allowedExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".pdf",
  ".txt",
  ".md",
  ".doc",
  ".docx",
  ".ppt",
  ".pptx",
  ".xls",
  ".xlsx",
  ".zip",
  ".csv"
]);

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { error: message });
}

function roomIdForPassword(password) {
  return createHash("sha256")
    .update(`${APP_SECRET}:${password.trim()}`)
    .digest("hex")
    .slice(0, 32);
}

function requireRoom(req) {
  const header = req.headers["x-room-password"];
  const password = Array.isArray(header) ? header[0] : header;
  if (!password || password.trim().length < 3) {
    return null;
  }
  return roomIdForPassword(password);
}

function roomPath(roomId) {
  return path.join(ROOMS_DIR, `${roomId}.json`);
}

function uploadDir(roomId) {
  return path.join(UPLOADS_DIR, roomId);
}

function safeFileName(name) {
  const ext = path.extname(name).toLowerCase();
  const base = path.basename(name, ext).replace(/[^a-z0-9._-]+/gi, "-").slice(0, 80);
  return `${base || "file"}${ext}`;
}

function isAllowedFile(name, type) {
  const ext = path.extname(name).toLowerCase();
  if (!allowedExtensions.has(ext)) return false;
  if (type && type.toLowerCase().startsWith("video/")) return false;
  return true;
}

async function ensureStorage() {
  await mkdir(ROOMS_DIR, { recursive: true });
  await mkdir(UPLOADS_DIR, { recursive: true });
}

async function readRoom(roomId) {
  await ensureStorage();
  try {
    const raw = await readFile(roomPath(roomId), "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return {
      id: roomId,
      text: "",
      files: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }
}

async function writeRoom(room) {
  await ensureStorage();
  room.updatedAt = new Date().toISOString();
  const target = roomPath(room.id);
  const temp = `${target}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(room, null, 2));
  await rename(temp, target);
}

async function readRequestBody(req, maxBytes = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new Error("Request is too large.");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseMultipart(buffer, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  if (!match) throw new Error("Missing multipart boundary.");
  const boundary = Buffer.from(`--${match[1] || match[2]}`);
  const parts = [];
  let cursor = buffer.indexOf(boundary);

  while (cursor !== -1) {
    cursor += boundary.length;
    if (buffer.slice(cursor, cursor + 2).toString() === "--") break;
    if (buffer.slice(cursor, cursor + 2).toString() === "\r\n") cursor += 2;

    const headerEnd = buffer.indexOf("\r\n\r\n", cursor);
    if (headerEnd === -1) break;
    const headerText = buffer.slice(cursor, headerEnd).toString("utf8");
    const contentStart = headerEnd + 4;
    let nextBoundary = buffer.indexOf(boundary, contentStart);
    if (nextBoundary === -1) break;
    let contentEnd = nextBoundary;
    if (buffer.slice(contentEnd - 2, contentEnd).toString() === "\r\n") {
      contentEnd -= 2;
    }

    const disposition = /content-disposition:\s*form-data;([^\r\n]+)/i.exec(headerText)?.[1] || "";
    const name = /name="([^"]+)"/i.exec(disposition)?.[1] || "";
    const filename = /filename="([^"]*)"/i.exec(disposition)?.[1] || "";
    const type = /content-type:\s*([^\r\n]+)/i.exec(headerText)?.[1]?.trim() || "application/octet-stream";

    parts.push({
      name,
      filename,
      type,
      data: buffer.slice(contentStart, contentEnd)
    });

    cursor = nextBoundary;
  }

  return parts;
}

async function serveStatic(req, res) {
  const requestedPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const normalizedPath = requestedPath === "/" ? "/index.html" : requestedPath;
  const filePath = path.normalize(path.join(PUBLIC_DIR, normalizedPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendError(res, 403, "Forbidden.");
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw Object.assign(new Error("Not found"), { code: "ENOENT" });
    res.writeHead(200, {
      "content-type": mimeTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream",
      "content-length": fileStat.size
    });
    createReadStream(filePath).pipe(res);
  } catch (error) {
    if (error.code === "ENOENT") {
      const indexPath = path.join(PUBLIC_DIR, "index.html");
      const indexStat = await stat(indexPath);
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-length": indexStat.size
      });
      createReadStream(indexPath).pipe(res);
      return;
    }
    sendError(res, 500, "Could not load the page.");
  }
}

async function serveUploadedFile(req, res, roomId, fileId) {
  const room = await readRoom(roomId);
  const file = room.files.find((item) => item.id === fileId);
  if (!file) {
    sendError(res, 404, "File not found.");
    return;
  }

  const filePath = path.join(uploadDir(roomId), file.storedName);
  try {
    const fileStat = await stat(filePath);
    res.writeHead(200, {
      "content-type": file.type || mimeTypes.get(path.extname(file.name).toLowerCase()) || "application/octet-stream",
      "content-length": fileStat.size,
      "content-disposition": `inline; filename="${encodeURIComponent(file.name)}"`
    });
    createReadStream(filePath).pipe(res);
  } catch (error) {
    sendError(res, 404, "File content is missing.");
  }
}

async function handleApi(req, res) {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/api/room" && req.method === "GET") {
    const roomId = requireRoom(req);
    if (!roomId) return sendError(res, 401, "Enter a password with at least 3 characters.");
    const room = await readRoom(roomId);
    sendJson(res, 200, {
      id: room.id,
      text: room.text,
      files: room.files,
      updatedAt: room.updatedAt
    });
    return;
  }

  if (url.pathname === "/api/room/text" && req.method === "PUT") {
    const roomId = requireRoom(req);
    if (!roomId) return sendError(res, 401, "Enter a password with at least 3 characters.");
    const body = await readRequestBody(req);
    const payload = JSON.parse(body.toString("utf8") || "{}");
    if (typeof payload.text !== "string") return sendError(res, 400, "Text is required.");
    if (Buffer.byteLength(payload.text, "utf8") > 500 * 1024) return sendError(res, 413, "Text is too large.");
    const room = await readRoom(roomId);
    room.text = payload.text;
    await writeRoom(room);
    sendJson(res, 200, { ok: true, updatedAt: room.updatedAt });
    return;
  }

  if (url.pathname === "/api/room/upload" && req.method === "POST") {
    const roomId = requireRoom(req);
    if (!roomId) return sendError(res, 401, "Enter a password with at least 3 characters.");
    const buffer = await readRequestBody(req, MAX_BATCH_UPLOAD_BYTES + 1024 * 256);
    const parts = parseMultipart(buffer, req.headers["content-type"]).filter(
      (item) => item.name === "file" && item.filename && item.data.length
    );
    if (!parts.length) return sendError(res, 400, "Choose at least one file to upload.");
    if (parts.length > MAX_UPLOAD_FILES) {
      return sendError(res, 413, `Upload ${MAX_UPLOAD_FILES} files or fewer at once.`);
    }

    for (const part of parts) {
      if (part.data.length > MAX_UPLOAD_BYTES) {
        return sendError(res, 413, `${safeFileName(part.filename)} is too large.`);
      }
      if (!isAllowedFile(part.filename, part.type)) {
        return sendError(res, 415, `${safeFileName(part.filename)} is not an allowed file type.`);
      }
    }

    const room = await readRoom(roomId);
    await mkdir(uploadDir(roomId), { recursive: true });

    const files = [];
    for (const part of parts) {
      const id = randomUUID();
      const cleanName = safeFileName(part.filename);
      const storedName = `${id}${path.extname(cleanName).toLowerCase()}`;
      await writeFile(path.join(uploadDir(roomId), storedName), part.data);
      files.push({
        id,
        name: cleanName,
        storedName,
        type: part.type,
        size: part.data.length,
        url: `/uploads/${roomId}/${id}`,
        uploadedAt: new Date().toISOString()
      });
    }

    room.files.unshift(...files);
    await writeRoom(room);
    sendJson(res, 201, { files, updatedAt: room.updatedAt });
    return;
  }

  const fileDeleteMatch = /^\/api\/room\/files\/([a-f0-9-]+)$/.exec(url.pathname);
  if (fileDeleteMatch && req.method === "DELETE") {
    const roomId = requireRoom(req);
    if (!roomId) return sendError(res, 401, "Enter a password with at least 3 characters.");
    const room = await readRoom(roomId);
    const file = room.files.find((item) => item.id === fileDeleteMatch[1]);
    if (!file) return sendError(res, 404, "File not found.");
    room.files = room.files.filter((item) => item.id !== file.id);
    await rm(path.join(uploadDir(roomId), file.storedName), { force: true });
    await writeRoom(room);
    sendJson(res, 200, { ok: true, updatedAt: room.updatedAt });
    return;
  }

  sendError(res, 404, "API route not found.");
}

async function route(req, res) {
  try {
    const url = new URL(req.url, "http://localhost");

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res);
      return;
    }

    const uploadMatch = /^\/uploads\/([a-f0-9]{32})\/([a-f0-9-]+)$/.exec(url.pathname);
    if (uploadMatch && req.method === "GET") {
      await serveUploadedFile(req, res, uploadMatch[1], uploadMatch[2]);
      return;
    }

    if (req.method === "GET" || req.method === "HEAD") {
      await serveStatic(req, res);
      return;
    }

    sendError(res, 405, "Method not allowed.");
  } catch (error) {
    console.error(error);
    sendError(res, 500, error.message || "Something went wrong.");
  }
}

await ensureStorage();
createServer(route).listen(PORT, () => {
  console.log(`PassPad is running at http://localhost:${PORT}`);
});
