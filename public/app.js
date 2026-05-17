const gate = document.querySelector("#gate");
const workspace = document.querySelector("#workspace");
const openForm = document.querySelector("#openForm");
const passwordInput = document.querySelector("#password");
const textArea = document.querySelector("#text");
const statusEl = document.querySelector("#status");
const saveState = document.querySelector("#saveState");
const fileInput = document.querySelector("#fileInput");
const uploadsEl = document.querySelector("#uploads");
const fileCount = document.querySelector("#fileCount");
const copyLink = document.querySelector("#copyLink");
const lockPad = document.querySelector("#lockPad");
const fileTemplate = document.querySelector("#fileTemplate");

const maxUploadBytes = 25 * 1024 * 1024;
const maxBatchUploadBytes = 100 * 1024 * 1024;
const maxUploadFiles = 10;
const blockedUploadExtensions = new Set([
  ".app",
  ".apk",
  ".bat",
  ".bin",
  ".cmd",
  ".com",
  ".deb",
  ".dmg",
  ".exe",
  ".ipa",
  ".jar",
  ".msi",
  ".pkg",
  ".ps1",
  ".scr",
  ".sh"
]);
let password = "";
let currentRoom = null;
let saveTimer = null;
let pollTimer = null;
let lastTextSent = "";
let dirtyLocally = false;

function setStatus(message) {
  statusEl.textContent = message;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function isImage(file) {
  return file.type?.startsWith("image/");
}

function fileExtension(name) {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index).toLowerCase() : "";
}

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function validateUploadFiles(files) {
  const errors = [];
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);

  if (files.length > maxUploadFiles) {
    errors.push(`Choose ${maxUploadFiles} files or fewer at once.`);
  }
  if (totalSize > maxBatchUploadBytes) {
    errors.push(`The selected files must be ${formatBytes(maxBatchUploadBytes)} or smaller together.`);
  }

  for (const file of files) {
    if (file.type.startsWith("video/")) {
      errors.push(`${file.name} is a video, which is not allowed.`);
    }
    if (blockedUploadExtensions.has(fileExtension(file.name))) {
      errors.push(`${file.name} is an app or script file, which is not allowed.`);
    }
    if (file.size > maxUploadBytes) {
      errors.push(`${file.name} must be ${formatBytes(maxUploadBytes)} or smaller.`);
    }
  }

  return errors;
}

function apiHeaders() {
  return { "x-room-password": password };
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...apiHeaders(),
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }
  return payload;
}

function renderFiles(files) {
  uploadsEl.innerHTML = "";
  fileCount.textContent = `${files.length} ${files.length === 1 ? "file" : "files"}`;

  if (!files.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No files uploaded yet.";
    uploadsEl.append(empty);
    return;
  }

  for (const file of files) {
    const item = fileTemplate.content.firstElementChild.cloneNode(true);
    const preview = item.querySelector(".preview");
    const name = item.querySelector(".file-name");
    const info = item.querySelector(".file-info");
    const deleteButton = item.querySelector(".delete");

    preview.href = file.url;
    name.href = file.url;
    name.textContent = file.name;
    info.textContent = `${formatBytes(file.size)} • ${new Date(file.uploadedAt).toLocaleString()}`;

    if (isImage(file)) {
      const img = document.createElement("img");
      img.src = file.url;
      img.alt = file.name;
      preview.append(img);
    } else {
      preview.textContent = file.name.split(".").pop()?.slice(0, 4).toUpperCase() || "FILE";
    }

    deleteButton.addEventListener("click", async () => {
      if (!confirm(`Delete ${file.name}?`)) return;
      deleteButton.disabled = true;
      try {
        await request(`/api/room/files/${file.id}`, { method: "DELETE" });
        await loadRoom({ quiet: true });
      } catch (error) {
        alert(error.message);
      } finally {
        deleteButton.disabled = false;
      }
    });

    uploadsEl.append(item);
  }
}

async function loadRoom({ quiet = false } = {}) {
  if (!quiet) setStatus("Loading...");
  const room = await request("/api/room");
  currentRoom = room;
  if (!dirtyLocally && textArea.value !== room.text) {
    textArea.value = room.text;
    lastTextSent = room.text;
  }
  renderFiles(room.files);
  setStatus(`Updated ${new Date(room.updatedAt).toLocaleTimeString()}`);
}

async function saveTextNow() {
  const text = textArea.value;
  if (text === lastTextSent) {
    saveState.textContent = "Saved";
    dirtyLocally = false;
    return;
  }

  saveState.textContent = "Saving...";
  await request("/api/room/text", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text })
  });
  lastTextSent = text;
  dirtyLocally = false;
  saveState.textContent = "Saved";
}

function scheduleSave() {
  dirtyLocally = true;
  saveState.textContent = "Unsaved";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await saveTextNow();
    } catch (error) {
      saveState.textContent = "Save failed";
      setStatus(error.message);
    }
  }, 700);
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (dirtyLocally) return;
    try {
      await loadRoom({ quiet: true });
    } catch (error) {
      setStatus(error.message);
    }
  }, 4000);
}

async function openPad(nextPassword) {
  password = nextPassword.trim();
  if (password.length < 3) {
    throw new Error("Use at least 3 characters.");
  }
  window.localStorage.setItem("passpad-password", password);
  gate.classList.add("hidden");
  workspace.classList.remove("hidden");
  await loadRoom();
  startPolling();
  textArea.focus();
}

openForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = openForm.querySelector("button");
  button.disabled = true;
  try {
    await openPad(passwordInput.value);
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
  }
});

textArea.addEventListener("input", scheduleSave);

fileInput.addEventListener("change", async () => {
  const files = Array.from(fileInput.files || []);
  if (!files.length) return;

  const errors = validateUploadFiles(files);
  if (errors.length) {
    alert(errors.join("\n"));
    fileInput.value = "";
    return;
  }

  setStatus(`Uploading ${pluralize(files.length, "file")}...`);
  fileInput.disabled = true;
  try {
    let uploadedCount = 0;
    const failures = [];
    for (const [index, file] of files.entries()) {
      const fileFormData = new FormData();
      fileFormData.append("file", file);
      setStatus(`Uploading ${index + 1} of ${files.length}: ${file.name}`);
      try {
        const result = await request("/api/room/upload", {
          method: "POST",
          body: fileFormData
        });
        uploadedCount += result.files?.length || (result.file ? 1 : 0);
      } catch (error) {
        failures.push(`${file.name}: ${error.message}`);
      }
    }
    await loadRoom({ quiet: true });
    if (failures.length) {
      alert(`Uploaded ${pluralize(uploadedCount, "file")}.\n\nCould not upload:\n${failures.join("\n")}`);
    }
    setStatus(failures.length ? `Uploaded ${uploadedCount}, failed ${failures.length}` : `Uploaded ${pluralize(uploadedCount, "file")}`);
  } catch (error) {
    alert(error.message);
    setStatus(error.message);
  } finally {
    fileInput.disabled = false;
    fileInput.value = "";
  }
});

copyLink.addEventListener("click", async () => {
  await navigator.clipboard.writeText(window.location.origin);
  copyLink.textContent = "Copied";
  setTimeout(() => {
    copyLink.textContent = "Copy link";
  }, 1200);
});

lockPad.addEventListener("click", () => {
  clearInterval(pollTimer);
  password = "";
  currentRoom = null;
  textArea.value = "";
  uploadsEl.innerHTML = "";
  window.localStorage.removeItem("passpad-password");
  workspace.classList.add("hidden");
  gate.classList.remove("hidden");
  passwordInput.value = "";
  passwordInput.focus();
});

const remembered = window.localStorage.getItem("passpad-password");
if (remembered) {
  passwordInput.value = remembered;
}
