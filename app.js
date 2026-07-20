(function () {
  "use strict";

  const CHUNK_SIZE = 256 * 1024; // 256KB per chunk
  // API_BASE should be your worker URL, or empty if same domain
  const API_BASE = location.origin.includes('workers.dev') ? location.origin : '';
  // If your frontend and backend are on different domains, set this:
  // const API_BASE = 'https://kiashare-api.YOUR_SUBDOMAIN.workers.dev';

  let pickedFiles = [];
  let currentCode = null;
  let uploadAbort = null;

  // ---------- navigation ----------
  function showScreen(id) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    document.getElementById(id).classList.add("active");
  }
  document.querySelectorAll("[data-back]").forEach((btn) => {
    btn.addEventListener("click", () => showScreen(btn.dataset.back));
  });

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
  }

  function toPersianDigits(str) {
    const fa = ["۰","۱","۲","۳","۴","۵","۶","۷","۸","۹"];
    return String(str).replace(/[0-9]/g, (d) => fa[d]);
  }

  // ---------- Jalali date ----------
  function jdiv(a, b) { return ~~(a / b); }
  function jmod(a, b) { return a - ~~(a / b) * b; }

  function g2d(gy, gm, gd) {
    let d = jdiv((gy + jdiv(gm - 8, 6) + 100100) * 1461, 4)
      + jdiv(153 * jmod(gm + 9, 12) + 2, 5)
      + gd - 34840408;
    d = d - jdiv(jdiv(gy + 100100 + jdiv(gm - 8, 6), 100) * 3, 4) + 752;
    return d;
  }

  function jalCal(jy) {
    const breaks = [-61,9,38,199,426,686,756,818,1111,1181,1210,1635,2060,2097,2192,2262,2324,2394,2456,3178];
    const bl = breaks.length;
    let gy = jy + 621;
    let leapJ = -14;
    let jp = breaks[0];
    let jm, jump, n, i;
    for (i = 1; i < bl; i += 1) {
      jm = breaks[i];
      jump = jm - jp;
      if (jy < jm) break;
      leapJ = leapJ + jdiv(jump, 33) * 8 + jdiv(jmod(jump, 33), 4);
      jp = jm;
    }
    n = jy - jp;
    leapJ = leapJ + jdiv(n, 33) * 8 + jdiv(jmod(n, 33) + 3, 4);
    if (jmod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
    const leapG = jdiv(gy, 4) - jdiv((jdiv(gy, 100) + 1) * 3, 4) - 150;
    const march = 20 + leapJ - leapG;
    return { gy: gy, march: march, jump: jump, n: n };
  }

  function toJalaali(gy, gm, gd) {
    const gDay = g2d(gy, gm, gd);
    let jyEstimate = gy - 621;
    let cal = jalCal(jyEstimate);
    let jDayNo = gDay - g2d(cal.gy, 3, cal.march);
    if (jDayNo < 0) {
      jyEstimate -= 1;
      cal = jalCal(jyEstimate);
      jDayNo = gDay - g2d(cal.gy, 3, cal.march);
    }
    let jm, jd;
    if (jDayNo < 186) {
      jm = 1 + jdiv(jDayNo, 31);
      jd = jmod(jDayNo, 31) + 1;
    } else {
      jm = 7 + jdiv(jDayNo - 186, 30);
      jd = jmod(jDayNo - 186, 30) + 1;
    }
    return { jy: jyEstimate, jm: jm, jd: jd };
  }

  function jalaliFolderName(timestampMs) {
    const d = new Date(timestampMs || Date.now());
    const j = toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate());
    return j.jy + "-" + String(j.jm).padStart(2, "0");
  }

  function getCategory(mime, name) {
    mime = mime || "";
    const ext = (name.split(".").pop() || "").toLowerCase();
    if (mime.startsWith("image/")) return "تصاویر";
    if (mime.startsWith("video/")) return "فیلم‌ها";
    if (mime.startsWith("audio/")) return "صداها";
    const docExt = ["pdf","doc","docx","xls","xlsx","ppt","pptx","txt","csv","zip","rar","7z"];
    if (docExt.indexOf(ext) > -1) return "اسناد";
    return "سایر";
  }

  function safeName(s) {
    return String(s).replace(/[\\/:*?"<>|]/g, "-");
  }

  // ================= HOME =================
  document.getElementById("btn-send").addEventListener("click", () => {
    showScreen("screen-pick");
  });
  document.getElementById("btn-receive").addEventListener("click", () => {
    showScreen("screen-connect");
  });

  // ================= PICK FILES (sender) =================
  const fileInput = document.getElementById("file-input");
  const dropZone = document.getElementById("drop-zone");
  const fileListEl = document.getElementById("file-list");
  const btnStartSend = document.getElementById("btn-start-send");

  fileInput.addEventListener("change", (e) => addFiles(e.target.files));
  ["dragover", "dragenter"].forEach((evt) =>
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.add("drag-over");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.remove("drag-over");
    })
  );
  dropZone.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));

  function addFiles(fileListLike) {
    pickedFiles = pickedFiles.concat(Array.from(fileListLike));
    renderFileList();
  }

  function renderFileList() {
    fileListEl.innerHTML = "";
    pickedFiles.forEach((f) => {
      const li = document.createElement("li");
      li.innerHTML =
        '<span class="file-icon">&#128196;</span>' +
        '<span class="file-name">' + f.name + "</span>" +
        '<span class="file-size">' + formatBytes(f.size) + "</span>";
      fileListEl.appendChild(li);
    });
    btnStartSend.disabled = pickedFiles.length === 0;
  }

  btnStartSend.addEventListener("click", async () => {
    showScreen("screen-qr");
    await startSender();
  });

  // ================= SENDER: create code + upload =================
  const qrBox = document.getElementById("qr-box");
  const pairCodeEl = document.getElementById("pair-code");
  const qrStatus = document.getElementById("qr-status");
  const shareLinkEl = document.getElementById("share-link");

  async function startSender() {
    try {
      qrStatus.textContent = "در حال آماده‌سازی…";

      // 1. Create session on server
      const totalSize = pickedFiles.reduce((s, f) => s + f.size, 0);
      const res = await fetch(`${API_BASE}/api/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: pickedFiles.map(f => ({ name: f.name, size: f.size, mime: f.type })),
          totalSize: totalSize,
          fileCount: pickedFiles.length
        })
      });

      if (!res.ok) throw new Error('Server error: ' + res.status);
      const data = await res.json();
      currentCode = data.code;

      // 2. Show code and link
      pairCodeEl.textContent = toPersianDigits(currentCode);
      qrStatus.textContent = "کد آماده است — منتظر گیرنده";

      const url = `${location.origin}${location.pathname}?code=${currentCode}`;
      shareLinkEl.textContent = url;

      // Simple QR code display
      qrBox.innerHTML = '<div style="padding:20px;text-align:center;"><div style="font-size:48px;margin-bottom:10px;">📱</div><div style="font-size:14px;color:var(--accent);">' + toPersianDigits(currentCode) + '</div></div>';

      // 3. Start uploading immediately
      uploadFiles(data.uploadUrl);

    } catch (err) {
      qrStatus.textContent = "خطا: " + err.message;
      console.error(err);
    }
  }

  async function uploadFiles(uploadUrlBase) {
    showScreen("screen-transfer");
    resetTransferScreen("در حال آپلود");
    document.getElementById("btn-cancel").onclick = () => {
      if (uploadAbort) uploadAbort.abort();
      location.reload();
    };

    uploadAbort = new AbortController();
    const totalBytes = pickedFiles.reduce((s, f) => s + f.size, 0);
    let sentBytes = 0;
    const startTime = Date.now();

    for (let fileIdx = 0; fileIdx < pickedFiles.length; fileIdx++) {
      const file = pickedFiles[fileIdx];
      const statusEl = addTransferRow(file.name, file.size);

      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
      const buf = await file.arrayBuffer();

      for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
        if (uploadAbort.signal.aborted) return;

        const start = chunkIdx * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = buf.slice(start, end);

        try {
          const res = await fetch(uploadUrlBase, {
            method: 'POST',
            headers: {
              'X-File-Index': String(fileIdx),
              'X-Chunk-Index': String(chunkIdx),
              'X-Total-Chunks': String(totalChunks),
              'X-File-Name': encodeURIComponent(file.name),
              'Content-Type': file.type || 'application/octet-stream'
            },
            body: chunk,
            signal: uploadAbort.signal
          });

          if (!res.ok) throw new Error('Upload failed: ' + res.status);

          sentBytes += (end - start);

          const filePct = Math.min(100, Math.round(((chunkIdx + 1) / totalChunks) * 100));
          const overallPct = Math.min(100, Math.round((sentBytes / totalBytes) * 100));
          statusEl.textContent = toPersianDigits(filePct) + "٪";
          progressBar.style.width = overallPct + "%";
          progressPercent.textContent = toPersianDigits(overallPct) + "٪";

          const elapsed = (Date.now() - startTime) / 1000;
          if (elapsed > 0.3) {
            progressSpeed.textContent = formatBytes(sentBytes / elapsed) + "/s";
          }

        } catch (err) {
          if (err.name === 'AbortError') return;
          statusEl.textContent = "خطا";
          statusEl.style.color = "var(--danger)";
          throw err;
        }
      }

      statusEl.textContent = "✓";
      statusEl.classList.add("done");
    }

    document.getElementById("transfer-title").textContent = "آپلود کامل شد — منتظر دانلود گیرنده";
    progressSpeed.textContent = "";
  }

  // ================= TRANSFER UI helpers =================
  const transferList = document.getElementById("transfer-list");
  const progressBar = document.getElementById("progress-overall-bar");
  const progressPercent = document.getElementById("progress-percent");
  const progressSpeed = document.getElementById("progress-speed");
  const transferTitle = document.getElementById("transfer-title");
  const downloadActions = document.getElementById("download-actions");

  function resetTransferScreen(title) {
    transferTitle.textContent = title;
    transferList.innerHTML = "";
    downloadActions.innerHTML = "";
    progressBar.style.width = "0%";
    progressPercent.textContent = "۰٪";
    progressSpeed.textContent = "";
  }

  function addTransferRow(name, size) {
    const li = document.createElement("li");
    li.innerHTML =
      '<span class="file-icon">&#128196;</span>' +
      '<span class="file-name">' + name + "</span>" +
      '<span class="file-size">' + formatBytes(size) + "</span>" +
      '<span class="file-status">۰٪</span>';
    transferList.appendChild(li);
    return li.querySelector(".file-status");
  }

  // ================= RECEIVER =================
  const codeInput = document.getElementById("code-input");
  const btnConnect = document.getElementById("btn-connect");
  const connectStatus = document.getElementById("connect-status");

  let pollInterval = null;
  let rootDirHandle = null;
  const supportsFolderPicker = "showDirectoryPicker" in window;

  async function getNestedDir(root, parts) {
    let dir = root;
    for (const p of parts) {
      dir = await dir.getDirectoryHandle(p, { create: true });
    }
    return dir;
  }

  btnConnect.addEventListener("click", async () => {
    const code = codeInput.value.trim();
    if (code.length !== 4) {
      connectStatus.textContent = "کد باید ۴ رقم باشد";
      return;
    }

    if (supportsFolderPicker) {
      try {
        rootDirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
      } catch (e) {
        rootDirHandle = null;
      }
    }

    connectStatus.textContent = "در حال بررسی…";
    startReceiving(code);
  });

  async function startReceiving(code) {
    showScreen("screen-transfer");
    resetTransferScreen("در حال دریافت");
    document.getElementById("btn-cancel").onclick = () => {
      if (pollInterval) clearInterval(pollInterval);
      location.reload();
    };

    // Poll for status every 2 seconds
    pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/status/${code}`);
        if (!res.ok) {
          if (res.status === 404) {
            connectStatus.textContent = "کد پیدا نشد یا منقضی شده";
            clearInterval(pollInterval);
            return;
          }
          throw new Error(res.status);
        }

        const data = await res.json();

        if (data.ready && data.files) {
          clearInterval(pollInterval);
          await downloadFiles(code, data.files);
        } else if (data.files) {
          connectStatus.textContent = `آماده‌سازی… ${data.files.filter(f => f.complete).length}/${data.files.length} فایل`;
        }

      } catch (err) {
        connectStatus.textContent = "خطا در بررسی وضعیت: " + err.message;
      }
    }, 2000);
  }

  // ================= FIXED DOWNLOAD FUNCTION =================
  async function downloadFiles(code, files) {
    resetTransferScreen("در حال دانلود");
    const startTime = Date.now();
    let receivedBytes = 0;
    const totalBytes = files.reduce((s, f) => s + (f.size || 0), 0);

    for (let i = 0; i < files.length; i++) {
      const fileInfo = files[i];
      const statusEl = addTransferRow(fileInfo.name, fileInfo.size || 0);

      try {
        // FIXED: Use fetch with proper handling
        const downloadUrl = `${API_BASE}/api/download/${code}/${i}`;
        console.log('Downloading:', downloadUrl, 'File:', fileInfo.name);

        const res = await fetch(downloadUrl, {
          method: 'GET',
          // Important: don't follow redirects automatically for debugging
          redirect: 'follow'
        });

        if (!res.ok) {
          throw new Error('Download failed: ' + res.status + ' ' + res.statusText);
        }

        // Check Content-Type
        const contentType = res.headers.get('Content-Type');
        const contentDisposition = res.headers.get('Content-Disposition');
        console.log('Content-Type:', contentType, 'CD:', contentDisposition);

        // Get the blob properly
        const blob = await res.blob();
        console.log('Blob size:', blob.size, 'type:', blob.type);

        receivedBytes += blob.size;

        // Update progress
        const filePct = fileInfo.size ? Math.min(100, Math.round((blob.size / fileInfo.size) * 100)) : 100;
        const overallPct = totalBytes ? Math.min(100, Math.round((receivedBytes / totalBytes) * 100)) : 0;
        statusEl.textContent = toPersianDigits(filePct) + "٪";
        progressBar.style.width = overallPct + "%";
        progressPercent.textContent = toPersianDigits(overallPct) + "٪";

        const elapsed = (Date.now() - startTime) / 1000;
        if (elapsed > 0.3) {
          progressSpeed.textContent = formatBytes(receivedBytes / elapsed) + "/s";
        }

        // Save file
        if (rootDirHandle) {
          const category = getCategory(fileInfo.mime, fileInfo.name);
          const dateFolder = jalaliFolderName(Date.now());

          try {
            const dir = await getNestedDir(rootDirHandle, [category, dateFolder]);
            const fileHandle = await dir.getFileHandle(safeName(fileInfo.name), { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();

            statusEl.textContent = "✓";
            statusEl.classList.add("done");
          } catch (err) {
            console.error('File System Access error:', err);
            fallbackDownload(blob, fileInfo.name);
            statusEl.textContent = "✓ (دانلود)";
            statusEl.classList.add("done");
          }
        } else {
          fallbackDownload(blob, fileInfo.name);
          statusEl.textContent = "✓";
          statusEl.classList.add("done");
        }

      } catch (err) {
        console.error('Download error:', err);
        statusEl.textContent = "خطا";
        statusEl.style.color = "var(--danger)";
        alert('خطا در دانلود ' + fileInfo.name + ': ' + err.message);
      }
    }

    document.getElementById("transfer-title").textContent = "دریافت کامل شد";
    progressSpeed.textContent = "";
  }

  // ================= FIXED FALLBACK DOWNLOAD =================
  function fallbackDownload(blob, name) {
    console.log('Fallback download:', name, 'blob size:', blob.size, 'type:', blob.type);

    // Create proper blob with correct type if possible
    const ext = name.split('.').pop().toLowerCase();
    const mimeMap = {
      'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'gif': 'image/gif',
      'webp': 'image/webp', 'svg': 'image/svg+xml',
      'mp4': 'video/mp4', 'webm': 'video/webm', 'mov': 'video/quicktime',
      'mp3': 'audio/mpeg', 'wav': 'audio/wav', 'ogg': 'audio/ogg',
      'pdf': 'application/pdf',
      'doc': 'application/msword', 'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'xls': 'application/vnd.ms-excel', 'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'ppt': 'application/vnd.ms-powerpoint', 'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'txt': 'text/plain', 'csv': 'text/csv', 'json': 'application/json',
      'zip': 'application/zip', 'rar': 'application/x-rar-compressed',
      'js': 'application/javascript', 'css': 'text/css', 'html': 'text/html'
    };
    const mimeType = mimeMap[ext] || blob.type || 'application/octet-stream';

    // Create new blob with correct type
    const finalBlob = new Blob([blob], { type: mimeType });

    const url = URL.createObjectURL(finalBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;  // This is the key attribute for download
    a.style.display = "none";

    // For mobile browsers, we need to append and click
    document.body.appendChild(a);

    // Trigger click
    const clickEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: window
    });
    a.dispatchEvent(clickEvent);

    // Cleanup
    setTimeout(() => {
      if (a.parentNode) document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 2000);
  }

  // ================= auto-connect via URL =================
  const params = new URLSearchParams(location.search);
  if (params.has("code")) {
    showScreen("screen-connect");
    codeInput.value = params.get("code");
    connectStatus.textContent = "کد پر شد — روی «اتصال» بزن";
  }

  // ================= PWA install =================
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
})();
