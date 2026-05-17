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
const downloadAll = document.querySelector("#downloadAll");
const lockPad = document.querySelector("#lockPad");
const themeToggle = document.querySelector("#themeToggle");
const dropZone = document.querySelector("#dropZone");
const uploadProgress = document.querySelector("#uploadProgress");
const progressFill = document.querySelector("#progressFill");
const progressText = document.querySelector("#progressText");
const fileSearch = document.querySelector("#fileSearch");
const fileSort = document.querySelector("#fileSort");
const editPasswordInput = document.querySelector("#editPassword");
const saveEditPassword = document.querySelector("#saveEditPassword");
const unlockEditRow = document.querySelector("#unlockEditRow");
const unlockEditPassword = document.querySelector("#unlockEditPassword");
const unlockEdit = document.querySelector("#unlockEdit");
const expiresIn = document.querySelector("#expiresIn");
const saveExpiry = document.querySelector("#saveExpiry");
const storageText = document.querySelector("#storageText");
const storageFill = document.querySelector("#storageFill");
const deletePad = document.querySelector("#deletePad");
const previewDialog = document.querySelector("#previewDialog");
const previewTitle = document.querySelector("#previewTitle");
const previewContent = document.querySelector("#previewContent");
const closePreview = document.querySelector("#closePreview");
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
let editPassword = "";
let currentRoom = null;
let currentFiles = [];
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

function fileExtension(name) {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index).toLowerCase() : "";
}

function isImage(file) {
  return file.type?.startsWith("image/") || [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(fileExtension(file.name));
}

function isPreviewableText(file) {
  return file.type?.startsWith("text/") || [".txt", ".md", ".csv", ".json", ".js", ".css", ".html"].includes(fileExtension(file.name));
}

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function editStorageKey(roomId) {
  return `passpad-edit-${roomId}`;
}

function apiHeaders() {
  return {
    "x-room-password": password,
    ...(editPassword ? { "x-edit-password": editPassword } : {})
  };
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

function filteredFiles() {
  const query = fileSearch.value.trim().toLowerCase();
  const files = currentFiles.filter((file) => file.name.toLowerCase().includes(query));

  return files.sort((a, b) => {
    if (fileSort.value === "oldest") return new Date(a.uploadedAt) - new Date(b.uploadedAt);
    if (fileSort.value === "name") return a.name.localeCompare(b.name);
    if (fileSort.value === "size") return Number(b.size || 0) - Number(a.size || 0);
    if (fileSort.value === "type") return fileExtension(a.name).localeCompare(fileExtension(b.name));
    return new Date(b.uploadedAt) - new Date(a.uploadedAt);
  });
}

function setProgress(percent, text) {
  uploadProgress.classList.remove("hidden");
  progressFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  progressText.textContent = text;
}

function clearProgressSoon() {
  setTimeout(() => {
    uploadProgress.classList.add("hidden");
    progressFill.style.width = "0%";
  }, 1400);
}

function applyAccessState() {
  if (!currentRoom) return;
  const canEdit = currentRoom.canEdit;
  textArea.readOnly = !canEdit;
  fileInput.disabled = !canEdit;
  saveEditPassword.disabled = !canEdit;
  saveExpiry.disabled = !canEdit;
  deletePad.disabled = !canEdit;
  dropZone.classList.toggle("disabled", !canEdit);
  unlockEditRow.classList.toggle("hidden", !currentRoom.editLocked || canEdit);
  if (!canEdit) saveState.textContent = "Read only";
  if (canEdit && saveState.textContent === "Read only") saveState.textContent = "Saved";
}

function renderStorage() {
  const used = currentRoom?.storage?.used || 0;
  const max = currentRoom?.storage?.max || 1;
  const percent = Math.min(100, Math.round((used / max) * 100));
  storageText.textContent = `${formatBytes(used)} used of ${formatBytes(max)}`;
  storageFill.style.width = `${percent}%`;
}

function renderFiles() {
  const files = filteredFiles();
  uploadsEl.innerHTML = "";
  fileCount.textContent = `${currentFiles.length} ${currentFiles.length === 1 ? "file" : "files"}`;

  if (!files.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = currentFiles.length ? "No files match your search." : "No files uploaded yet.";
    uploadsEl.append(empty);
    return;
  }

  for (const file of files) {
    const item = fileTemplate.content.firstElementChild.cloneNode(true);
    const preview = item.querySelector(".preview");
    const name = item.querySelector(".file-name");
    const info = item.querySelector(".file-info");
    const previewButton = item.querySelector(".preview-file");
    const renameButton = item.querySelector(".rename");
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
      preview.textContent = fileExtension(file.name).replace(".", "").slice(0, 4).toUpperCase() || "FILE";
    }

    previewButton.addEventListener("click", () => showPreview(file));

    renameButton.disabled = !currentRoom?.canEdit;
    renameButton.addEventListener("click", async () => {
      const nextName = prompt("Rename file", file.name);
      if (!nextName || nextName === file.name) return;
      renameButton.disabled = true;
      try {
        await request(`/api/room/files/${file.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: nextName })
        });
        await loadRoom({ quiet: true });
      } catch (error) {
        alert(error.message);
      } finally {
        renameButton.disabled = !currentRoom?.canEdit;
      }
    });

    deleteButton.disabled = !currentRoom?.canEdit;
    deleteButton.addEventListener("click", async () => {
      if (!confirm(`Delete ${file.name}?`)) return;
      deleteButton.disabled = true;
      try {
        await request(`/api/room/files/${file.id}`, { method: "DELETE" });
        await loadRoom({ quiet: true });
      } catch (error) {
        alert(error.message);
      } finally {
        deleteButton.disabled = !currentRoom?.canEdit;
      }
    });

    uploadsEl.append(item);
  }
}

async function showPreview(file) {
  previewTitle.textContent = file.name;
  previewContent.innerHTML = "";

  if (isImage(file)) {
    const image = document.createElement("img");
    image.src = file.url;
    image.alt = file.name;
    previewContent.append(image);
  } else if (file.type === "application/pdf" || fileExtension(file.name) === ".pdf") {
    const iframe = document.createElement("iframe");
    iframe.src = file.url;
    iframe.title = file.name;
    previewContent.append(iframe);
  } else if (isPreviewableText(file)) {
    const pre = document.createElement("pre");
    pre.textContent = "Loading...";
    previewContent.append(pre);
    const response = await fetch(file.url);
    pre.textContent = await response.text();
  } else {
    const link = document.createElement("a");
    link.href = file.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = "Open or download this file";
    previewContent.append(link);
  }

  previewDialog.showModal();
}

async function loadRoom({ quiet = false } = {}) {
  if (!quiet) setStatus("Loading...");
  const room = await request("/api/room");
  if (room.editLocked && !room.canEdit && !editPassword) {
    editPassword = window.localStorage.getItem(editStorageKey(room.id)) || "";
    if (editPassword) {
      const unlockedRoom = await request("/api/room");
      currentRoom = unlockedRoom;
    } else {
      currentRoom = room;
    }
  } else {
    currentRoom = room;
  }

  currentFiles = currentRoom.files || [];
  if (!dirtyLocally && textArea.value !== currentRoom.text) {
    textArea.value = currentRoom.text;
    lastTextSent = currentRoom.text;
  }

  renderFiles();
  renderStorage();
  applyAccessState();
  const expiry = currentRoom.expiresAt ? ` • expires ${new Date(currentRoom.expiresAt).toLocaleString()}` : "";
  setStatus(`Updated ${new Date(currentRoom.updatedAt).toLocaleTimeString()}${expiry}`);
}

async function saveTextNow() {
  if (!currentRoom?.canEdit) return;
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
  if (!currentRoom?.canEdit) return;
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
  editPassword = "";
  window.localStorage.setItem("passpad-password", password);
  gate.classList.add("hidden");
  workspace.classList.remove("hidden");
  await loadRoom();
  startPolling();
  textArea.focus();
}

function uploadFile(file, progressOffset, progressShare) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append("file", file);

    xhr.open("POST", "/api/room/upload");
    for (const [key, value] of Object.entries(apiHeaders())) {
      xhr.setRequestHeader(key, value);
    }

    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      const percent = progressOffset + (event.loaded / event.total) * progressShare;
      setProgress(percent, `Uploading ${file.name}`);
    });

    xhr.addEventListener("load", () => {
      const payload = JSON.parse(xhr.responseText || "{}");
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload);
      } else {
        reject(new Error(payload.error || "Upload failed."));
      }
    });

    xhr.addEventListener("error", () => reject(new Error("Upload failed.")));
    xhr.send(formData);
  });
}

async function uploadFiles(filesLike) {
  if (!currentRoom?.canEdit) {
    alert("Enter the edit password before uploading.");
    return;
  }

  const files = Array.from(filesLike || []);
  if (!files.length) return;

  const errors = validateUploadFiles(files);
  if (errors.length) {
    alert(errors.join("\n"));
    fileInput.value = "";
    return;
  }

  fileInput.disabled = true;
  setProgress(0, `Uploading ${pluralize(files.length, "file")}...`);
  const failures = [];
  let uploadedCount = 0;

  for (const [index, file] of files.entries()) {
    try {
      const result = await uploadFile(file, (index / files.length) * 100, 100 / files.length);
      uploadedCount += result.files?.length || (result.file ? 1 : 0);
    } catch (error) {
      failures.push(`${file.name}: ${error.message}`);
    }
  }

  await loadRoom({ quiet: true });
  setProgress(100, failures.length ? `Uploaded ${uploadedCount}, failed ${failures.length}` : `Uploaded ${pluralize(uploadedCount, "file")}`);
  clearProgressSoon();
  fileInput.disabled = !currentRoom?.canEdit;
  fileInput.value = "";

  if (failures.length) {
    alert(`Uploaded ${pluralize(uploadedCount, "file")}.\n\nCould not upload:\n${failures.join("\n")}`);
  }
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
fileInput.addEventListener("change", () => uploadFiles(fileInput.files));
fileSearch.addEventListener("input", renderFiles);
fileSort.addEventListener("change", renderFiles);

dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  if (!currentRoom?.canEdit) return;
  dropZone.classList.add("dragging");
});

dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragging"));
dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("dragging");
  uploadFiles(event.dataTransfer.files);
});

document.addEventListener("paste", (event) => {
  if (workspace.classList.contains("hidden") || !currentRoom?.canEdit) return;
  const files = Array.from(event.clipboardData?.files || []).filter((file) => file.type.startsWith("image/"));
  if (files.length) {
    uploadFiles(files.map((file, index) => new File([file], file.name || `pasted-image-${index + 1}.png`, { type: file.type })));
  }
});

copyLink.addEventListener("click", async () => {
  await navigator.clipboard.writeText(window.location.origin);
  copyLink.textContent = "Copied";
  setTimeout(() => {
    copyLink.textContent = "Copy link";
  }, 1200);
});

downloadAll.addEventListener("click", () => {
  if (!currentRoom?.id) return;
  window.location.href = `/download/${currentRoom.id}.zip`;
});

saveEditPassword.addEventListener("click", async () => {
  try {
    const nextPassword = editPasswordInput.value.trim();
    const room = await request("/api/room/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ editPassword: nextPassword })
    });
    editPassword = nextPassword;
    if (room.id) {
      if (nextPassword) window.localStorage.setItem(editStorageKey(room.id), nextPassword);
      else window.localStorage.removeItem(editStorageKey(room.id));
    }
    editPasswordInput.value = "";
    await loadRoom({ quiet: true });
    setStatus(nextPassword ? "Edit password saved" : "Edit password removed");
  } catch (error) {
    alert(error.message);
  }
});

unlockEdit.addEventListener("click", async () => {
  editPassword = unlockEditPassword.value.trim();
  if (!editPassword) return;
  if (currentRoom?.id) window.localStorage.setItem(editStorageKey(currentRoom.id), editPassword);
  unlockEditPassword.value = "";
  await loadRoom({ quiet: true });
  if (!currentRoom.canEdit) alert("That edit password did not unlock the pad.");
});

saveExpiry.addEventListener("click", async () => {
  try {
    await request("/api/room/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expiresIn: expiresIn.value })
    });
    await loadRoom({ quiet: true });
    setStatus("Expiry updated");
  } catch (error) {
    alert(error.message);
  }
});

deletePad.addEventListener("click", async () => {
  if (!confirm("Delete all text and uploaded files in this pad?")) return;
  try {
    await request("/api/room", { method: "DELETE" });
    textArea.value = "";
    currentFiles = [];
    await loadRoom({ quiet: true });
    setStatus("Pad deleted");
  } catch (error) {
    alert(error.message);
  }
});

lockPad.addEventListener("click", () => {
  clearInterval(pollTimer);
  password = "";
  editPassword = "";
  currentRoom = null;
  currentFiles = [];
  textArea.value = "";
  uploadsEl.innerHTML = "";
  window.localStorage.removeItem("passpad-password");
  workspace.classList.add("hidden");
  gate.classList.remove("hidden");
  passwordInput.value = "";
  passwordInput.focus();
});

themeToggle.addEventListener("click", () => {
  const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = nextTheme;
  window.localStorage.setItem("passpad-theme", nextTheme);
  themeToggle.textContent = nextTheme === "dark" ? "Light" : "Dark";
});

closePreview.addEventListener("click", () => previewDialog.close());

const rememberedTheme = window.localStorage.getItem("passpad-theme") || "light";
document.documentElement.dataset.theme = rememberedTheme;
themeToggle.textContent = rememberedTheme === "dark" ? "Light" : "Dark";

const remembered = window.localStorage.getItem("passpad-password");
if (remembered) {
  passwordInput.value = remembered;
}
