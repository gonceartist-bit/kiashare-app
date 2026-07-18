(function () {
  "use strict";

  const CHUNK_SIZE = 64 * 1024; // 64KB per chunk
  const BUFFER_HIGH_WATER = 4 * 1024 * 1024; // pause sending above this
  const PEER_PREFIX = "filedrop-";

  let peer = null;
  let conn = null;
  let pickedFiles = [];
  let sendStartTime = 0;

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
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function toPersianDigits(str) {
    const fa = ["۰","۱","۲","۳","۴","۵","۶","۷","۸","۹"];
    return String(str).replace(/[0-9]/g, (d) => fa[d]);
  }

  // ---------- Gregorian -> Jalali (Persian) date ----------
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

  // ---------- file category ----------
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
    pickedFiles.forEach((f, idx) => {
      const li = document.createElement("li");
      li.innerHTML =
        '<span class="file-icon">&#128196;</span>' +
        '<span class="file-name">' + f.name + "</span>" +
        '<span class="file-size">' + formatBytes(f.size) + "</span>";
      fileListEl.appendChild(li);
    });
    btnStartSend.disabled = pickedFiles.length === 0;
  }

  btnStartSend.addEventListener("click", () => {
    showScreen("screen-qr");
    startSenderPeer();
  });

  // ================= SENDER: create peer + QR =================
  const qrBox = document.getElementById("qr-box");
  const pairCodeEl = document.getElementById("pair-code");
  const qrStatus = document.getElementById("qr-status");

  function randomCode() {
    return String(Math.floor(1000 + Math.random() * 9000));
  }

  function startSenderPeer(retry) {
    const code = randomCode();
    if (peer) peer.destroy();
    peer = new Peer(PEER_PREFIX + code, { debug: 0, serialization: "none" });

    peer.on("open", () => {
      pairCodeEl.textContent = toPersianDigits(code);
      qrStatus.textContent = "منتظر اتصال گیرنده…";
      const url = location.origin + location.pathname + "?peer=" + code;
      qrBox.innerHTML = "";
      new QRCode(qrBox, { text: url, width: 160, height: 160, correctLevel: QRCode.CorrectLevel.M });
    });

    peer.on("connection", (c) => {
      conn = c;
      qrStatus.textContent = "متصل شد، در حال شروع انتقال…";
      conn.on("open", () => sendAllFiles());
    });

    peer.on("error", (err) => {
      if (err.type === "unavailable-id" && !retry) {
        startSenderPeer(true);
      } else {
        qrStatus.textContent = "خطا در اتصال: " + err.type;
      }
    });
  }

  // ================= SENDER: transfer logic =================
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

  async function sendAllFiles() {
    showScreen("screen-transfer");
    resetTransferScreen("در حال ارسال");
    document.getElementById("btn-cancel").onclick = () => location.reload();

    const totalBytes = pickedFiles.reduce((s, f) => s + f.size, 0);
    let sentBytes = 0;
    sendStartTime = Date.now();

    for (const file of pickedFiles) {
      const statusEl = addTransferRow(file.name, file.size);
      conn.send(JSON.stringify({
        type: "meta",
        name: file.name,
        size: file.size,
        mime: file.type,
        lastModified: file.lastModified
      }));

      let offset = 0;
      const buf = await file.arrayBuffer();
      while (offset < buf.byteLength) {
        // backpressure: wait for the channel to drain instead of polling
        const dc = conn.dataChannel;
        if (dc && dc.bufferedAmount > BUFFER_HIGH_WATER) {
          await new Promise((resolve) => {
            dc.bufferedAmountLowThreshold = CHUNK_SIZE * 4;
            const onLow = () => { dc.removeEventListener("bufferedamountlow", onLow); resolve(); };
            dc.addEventListener("bufferedamountlow", onLow);
          });
        }
        const chunk = buf.slice(offset, offset + CHUNK_SIZE);
        conn.send(chunk);
        offset += chunk.byteLength;
        sentBytes += chunk.byteLength;

        const filePct = Math.min(100, Math.round((offset / buf.byteLength) * 100));
        const overallPct = Math.min(100, Math.round((sentBytes / totalBytes) * 100));
        statusEl.textContent = toPersianDigits(filePct) + "٪";
        progressBar.style.width = overallPct + "%";
        progressPercent.textContent = toPersianDigits(overallPct) + "٪";
        const elapsed = (Date.now() - sendStartTime) / 1000;
        if (elapsed > 0.3) {
          const speed = sentBytes / elapsed;
          progressSpeed.textContent = formatBytes(speed) + "/s";
        }
      }
      conn.send(JSON.stringify({ type: "eof", name: file.name }));
      statusEl.textContent = "✓";
      statusEl.classList.add("done");
    }
    transferTitle.textContent = "ارسال کامل شد";
  }

  // ================= RECEIVER =================
  const codeInput = document.getElementById("code-input");
  const btnConnect = document.getElementById("btn-connect");
  const connectStatus = document.getElementById("connect-status");

  let incomingMeta = null;
  let incomingChunks = [];
  let incomingReceived = 0;
  let receivedFilesInfo = [];
  let expectedTotal = 0;
  let receivedTotal = 0;
  let recvStartTime = 0;

  let rootDirHandle = null;      // set if File System Access API is available and user picked a folder
  let currentWritable = null;    // active streaming writer for the file being received
  let writeChain = Promise.resolve();

  const supportsFolderPicker = "showDirectoryPicker" in window;

  async function getNestedDir(root, parts) {
    let dir = root;
    for (const p of parts) {
      dir = await dir.getDirectoryHandle(p, { create: true });
    }
    return dir;
  }

  function connectToCode(code) {
    connectStatus.textContent = "در حال اتصال…";
    peer = new Peer(undefined, { debug: 0, serialization: "none" });
    peer.on("open", () => {
      conn = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: "none" });
      conn.on("open", () => {
        connectStatus.textContent = "متصل شد";
        showScreen("screen-transfer");
        resetTransferScreen("در حال دریافت");
        document.getElementById("btn-cancel").onclick = () => location.reload();
        recvStartTime = Date.now();
      });
      conn.on("data", handleIncomingData);
      conn.on("error", (err) => {
        connectStatus.textContent = "اتصال برقرار نشد";
      });
    });
    peer.on("error", (err) => {
      connectStatus.textContent = "اتصال برقرار نشد: " + err.type;
    });
  }

  let currentStatusEl = null;

  function handleIncomingData(data) {
    if (typeof data === "string") {
      const msg = JSON.parse(data);
      if (msg.type === "meta") {
        incomingMeta = msg;
        incomingChunks = [];
        incomingReceived = 0;
        currentStatusEl = addTransferRow(msg.name, msg.size);

        const category = getCategory(msg.mime, msg.name);
        const dateFolder = jalaliFolderName(msg.lastModified);

        if (rootDirHandle) {
          // stream directly into <root>/<category>/<jalali year-month>/<name>
          writeChain = writeChain
            .then(() => getNestedDir(rootDirHandle, [category, dateFolder]))
            .then((dir) => dir.getFileHandle(safeName(msg.name), { create: true }))
            .then((fh) => fh.createWritable())
            .then((w) => { currentWritable = w; })
            .catch((err) => {
              currentStatusEl.textContent = "خطا";
              document.getElementById("transfer-title").textContent = "ذخیره ناموفق بود: " + err.message;
            });
        } else {
          // fallback: label the filename so it can be sorted manually after a plain download
          incomingMeta._fallbackName = category + "_" + dateFolder + "_" + safeName(msg.name);
        }
      } else if (msg.type === "eof") {
        if (rootDirHandle) {
          writeChain = writeChain
            .then(() => currentWritable && currentWritable.close())
            .then(() => {
              if (currentStatusEl.textContent === "خطا") return;
              currentStatusEl.textContent = "✓";
              currentStatusEl.classList.add("done");
              receivedFilesInfo.push(msg.name);
              document.getElementById("transfer-title").textContent =
                receivedFilesInfo.length + " فایل ذخیره شد";
            })
            .catch((err) => {
              currentStatusEl.textContent = "خطا";
              document.getElementById("transfer-title").textContent = "ذخیره ناموفق بود: " + err.message;
            });
        } else {
          const blob = new Blob(incomingChunks, { type: incomingMeta.mime || "application/octet-stream" });
          const url = URL.createObjectURL(blob);
          currentStatusEl.textContent = "✓";
          currentStatusEl.classList.add("done");

          const a = document.createElement("a");
          a.href = url;
          a.download = incomingMeta._fallbackName || incomingMeta.name;
          a.textContent = "دانلود " + incomingMeta.name;
          downloadActions.appendChild(a);
          a.click();

          receivedFilesInfo.push(incomingMeta.name);
          document.getElementById("transfer-title").textContent =
            receivedFilesInfo.length + " فایل دریافت شد";
        }
      }
    } else {
      // binary chunk (ArrayBuffer)
      incomingReceived += data.byteLength;
      receivedTotal += data.byteLength;

      if (rootDirHandle) {
        writeChain = writeChain.then(() => currentWritable.write(data));
      } else {
        incomingChunks.push(data);
      }

      const filePct = Math.min(100, Math.round((incomingReceived / incomingMeta.size) * 100));
      currentStatusEl.textContent = toPersianDigits(filePct) + "٪";

      const elapsed = (Date.now() - recvStartTime) / 1000;
      if (elapsed > 0.3) {
        progressSpeed.textContent = formatBytes(receivedTotal / elapsed) + "/s";
      }
      progressBar.style.width = filePct + "%";
      progressPercent.textContent = toPersianDigits(filePct) + "٪";
    }
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
        rootDirHandle = null; // user cancelled the picker — fall back to plain downloads
      }
    }
    connectToCode(code);
  });

  // ================= auto-connect via QR URL =================
  const params = new URLSearchParams(location.search);
  if (params.has("peer")) {
    showScreen("screen-connect");
    codeInput.value = params.get("peer");
    connectStatus.textContent = "کد پر شد — روی «اتصال» بزن";
  }

  // ================= PWA install =================
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
})();
