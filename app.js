const video = document.querySelector("#camera");
const overlay = document.querySelector("#overlay");
const ctx = overlay.getContext("2d");
const work = document.querySelector("#work");
const wctx = work.getContext("2d", { willReadFrequently: true });

const startButton = document.querySelector("#startButton");
const statusText = document.querySelector("#status");
const distanceMeters = document.querySelector("#distanceMeters");
const sensitivity = document.querySelector("#sensitivity");
const minArea = document.querySelector("#minArea");
const showDebug = document.querySelector("#showDebug");
const recordSnapshots = document.querySelector("#recordSnapshots");
const recordsEl = document.querySelector("#records");
const trackCountEl = document.querySelector("#trackCount");
const logCountEl = document.querySelector("#logCount");
const latestSpeedEl = document.querySelector("#latestSpeed");
const downloadCsv = document.querySelector("#downloadCsv");
const clearLogs = document.querySelector("#clearLogs");
const plateEditor = document.querySelector("#plateEditor");
const platePreview = document.querySelector("#platePreview");
const plateInput = document.querySelector("#plateInput");
const savePlate = document.querySelector("#savePlate");
const cameraHelp = document.querySelector("#cameraHelp");
const demoButton = document.querySelector("#demoButton");
const mobileNotice = document.querySelector("#mobileNotice");

const sampleWidth = 240;
const sampleHeight = 135;
const maxTrackAge = 900;
const gateA = 0.36;
const gateB = 0.64;

let previousFrame = null;
let tracks = new Map();
let nextTrackId = 1;
let logs = [];
let selectedLogId = null;
let lastFrameAt = 0;
let analysisStarted = false;
let activeStream = null;
let wakeLock = null;

startButton.addEventListener("click", startCamera);
demoButton.addEventListener("click", startDemo);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && activeStream) requestWakeLock();
});
downloadCsv.addEventListener("click", exportCsv);
clearLogs.addEventListener("click", () => {
  logs = [];
  selectedLogId = null;
  renderLogs();
});
savePlate.addEventListener("click", () => {
  const item = logs.find((log) => log.id === selectedLogId);
  if (!item) return;
  item.plate = plateInput.value.trim();
  plateEditor.hidden = true;
  renderLogs();
});

async function startCamera() {
  cameraHelp.hidden = true;
  startButton.disabled = true;
  startButton.textContent = "確認中";
  try {
    if (!window.isSecureContext) {
      throw new Error("INSECURE_CONTEXT");
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("MEDIA_DEVICES_UNAVAILABLE");
    }
    const stream = await openCameraStream();
    stopActiveStream();
    activeStream = stream;
    video.srcObject = stream;
    await video.play();
    statusText.textContent = "測定中";
    startButton.textContent = "稼働中";
    startButton.disabled = true;
    resizeCanvases();
    resetAnalyzer();
    requestWakeLock();
    startAnalysisLoop();
  } catch (error) {
    startButton.disabled = false;
    startButton.textContent = "再試行";
    showCameraError(error);
  }
}

async function openCameraStream() {
  const mobile = isMobileDevice();
  const videoConstraints = {
    width: { ideal: mobile ? 1920 : 1280 },
    height: { ideal: mobile ? 1080 : 720 },
  };
  if (mobile) videoConstraints.facingMode = { ideal: "environment" };

  const preferred = {
    video: videoConstraints,
    audio: false,
  };

  try {
    return await navigator.mediaDevices.getUserMedia(preferred);
  } catch (error) {
    if (!mobile) throw error;
    return navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
  }
}

function showCameraError(error) {
  console.error(error);
  const name = error?.name || error?.message || "UnknownError";
  const messages = {
    NotAllowedError: "カメラ権限が拒否されています。ブラウザのアドレスバー、またはOSの設定でカメラを許可してから再試行してください。",
    NotFoundError: "カメラが見つかりません。スマホではSafari/Chromeを使い、別アプリがカメラを使用中でないか確認してください。",
    NotReadableError: "カメラを開けません。FaceTime、Zoom、ブラウザなど他のカメラ利用アプリを閉じてから再試行してください。",
    OverconstrainedError: "指定したカメラ条件を使えません。再試行すると標準カメラ設定で開きます。",
    INSECURE_CONTEXT: "スマホでカメラを使うにはHTTPSが必要です。LANの http://192.168... では画面表示はできますが、カメラはブラウザにブロックされます。",
    MEDIA_DEVICES_UNAVAILABLE: "このブラウザではカメラAPIを利用できません。スマホではSafariまたはChromeでHTTPSのURLを開いてください。",
  };
  statusText.textContent = "カメラ権限を確認してください";
  cameraHelp.textContent = messages[name] || `カメラを開始できません: ${name}`;
  cameraHelp.hidden = false;
}

function startDemo() {
  cameraHelp.hidden = true;
  statusText.textContent = "デモ測定中";
  const stream = makeDemoStream();
  stopActiveStream();
  activeStream = stream;
  video.srcObject = stream;
  video.play();
  resizeCanvases();
  resetAnalyzer();
  startAnalysisLoop();
}

function stopActiveStream() {
  if (!activeStream) return;
  for (const track of activeStream.getTracks()) track.stop();
  activeStream = null;
}

function resetAnalyzer() {
  previousFrame = null;
  tracks = new Map();
  lastFrameAt = 0;
}

function startAnalysisLoop() {
  if (analysisStarted) return;
  analysisStarted = true;
  requestAnimationFrame(loop);
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
  } catch (error) {
    wakeLock = null;
  }
}

function isMobileDevice() {
  return matchMedia("(pointer: coarse)").matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function showMobileNotice() {
  if (!isMobileDevice()) return;
  if (window.isSecureContext) {
    mobileNotice.textContent = "スマホでは背面カメラを優先して起動します。測定中は端末を固定し、2本の縦ゲートを車が左右方向に横切るように向けてください。";
  } else {
    mobileNotice.textContent = "このURLはHTTPSではないため、スマホのブラウザではカメラがブロックされます。HTTPSで公開したURLを開くと実カメラで測定できます。";
  }
  mobileNotice.hidden = false;
}

function makeDemoStream() {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const demoCtx = canvas.getContext("2d");
  let x = -260;
  let hue = 4;
  let direction = 1;

  function draw() {
    demoCtx.fillStyle = "#273039";
    demoCtx.fillRect(0, 0, canvas.width, canvas.height);

    demoCtx.fillStyle = "#3d474f";
    demoCtx.beginPath();
    demoCtx.moveTo(0, 455);
    demoCtx.lineTo(canvas.width, 270);
    demoCtx.lineTo(canvas.width, 575);
    demoCtx.lineTo(0, 720);
    demoCtx.closePath();
    demoCtx.fill();

    demoCtx.strokeStyle = "#d8dde2";
    demoCtx.lineWidth = 6;
    demoCtx.setLineDash([42, 34]);
    demoCtx.beginPath();
    demoCtx.moveTo(0, 590);
    demoCtx.lineTo(canvas.width, 420);
    demoCtx.stroke();
    demoCtx.setLineDash([]);

    const progress = direction === 1 ? x : canvas.width - x - 250;
    const y = 422 - progress * 0.12;
    const carX = x;
    const carY = y + Math.sin(x / 95) * 5;
    demoCtx.fillStyle = `hsl(${hue}, 68%, 45%)`;
    demoCtx.beginPath();
    demoCtx.moveTo(carX + 25, carY + 70);
    demoCtx.lineTo(carX + 65, carY + 25);
    demoCtx.lineTo(carX + 175, carY + 15);
    demoCtx.lineTo(carX + 235, carY + 58);
    demoCtx.lineTo(carX + 248, carY + 105);
    demoCtx.lineTo(carX + 8, carY + 112);
    demoCtx.closePath();
    demoCtx.fill();
    demoCtx.fillStyle = "#121a22";
    demoCtx.fillRect(carX + 78, carY + 32, 72, 31);
    demoCtx.fillRect(carX + 156, carY + 28, 48, 34);
    demoCtx.fillStyle = "#f4f0dc";
    demoCtx.fillRect(direction === 1 ? carX + 202 : carX + 30, carY + 78, 56, 20);
    demoCtx.fillStyle = "#1d242b";
    demoCtx.beginPath();
    demoCtx.arc(carX + 58, carY + 108, 22, 0, Math.PI * 2);
    demoCtx.arc(carX + 204, carY + 103, 22, 0, Math.PI * 2);
    demoCtx.fill();

    x += 8 * direction;
    if (x > canvas.width + 260 || x < -310) {
      direction *= -1;
      x = direction === 1 ? -260 : canvas.width + 260;
      hue = (hue + 135) % 360;
    }
    requestAnimationFrame(draw);
  }

  draw();
  return canvas.captureStream(30);
}

function resizeCanvases() {
  const rect = video.getBoundingClientRect();
  overlay.width = Math.round(rect.width * devicePixelRatio);
  overlay.height = Math.round(rect.height * devicePixelRatio);
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  work.width = sampleWidth;
  work.height = sampleHeight;
}

function loop(now) {
  if (video.readyState >= 2 && now - lastFrameAt > 80) {
    analyzeFrame(now);
    drawOverlay(now);
    lastFrameAt = now;
  }
  requestAnimationFrame(loop);
}

function analyzeFrame(now) {
  wctx.drawImage(video, 0, 0, sampleWidth, sampleHeight);
  const frame = wctx.getImageData(0, 0, sampleWidth, sampleHeight);
  const data = frame.data;

  if (!previousFrame) {
    previousFrame = new Uint8ClampedArray(data);
    return;
  }

  const boxes = findMotionBoxes(data, previousFrame, Number(sensitivity.value), Number(minArea.value));
  previousFrame.set(data);
  updateTracks(boxes, data, now);
}

function findMotionBoxes(data, previous, threshold, minPixels) {
  const visited = new Uint8Array(sampleWidth * sampleHeight);
  const moving = new Uint8Array(sampleWidth * sampleHeight);

  for (let y = 0; y < sampleHeight; y += 1) {
    for (let x = 0; x < sampleWidth; x += 1) {
      const i = (y * sampleWidth + x) * 4;
      const delta =
        Math.abs(data[i] - previous[i]) +
        Math.abs(data[i + 1] - previous[i + 1]) +
        Math.abs(data[i + 2] - previous[i + 2]);
      if (delta > threshold * 3) moving[y * sampleWidth + x] = 1;
    }
  }

  const boxes = [];
  const stack = [];
  for (let y = 0; y < sampleHeight; y += 1) {
    for (let x = 0; x < sampleWidth; x += 1) {
      const start = y * sampleWidth + x;
      if (!moving[start] || visited[start]) continue;

      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let count = 0;
      stack.push(start);
      visited[start] = 1;

      while (stack.length) {
        const index = stack.pop();
        const px = index % sampleWidth;
        const py = Math.floor(index / sampleWidth);
        count += 1;
        minX = Math.min(minX, px);
        maxX = Math.max(maxX, px);
        minY = Math.min(minY, py);
        maxY = Math.max(maxY, py);

        for (const next of [index - 1, index + 1, index - sampleWidth, index + sampleWidth]) {
          if (next < 0 || next >= moving.length || visited[next] || !moving[next]) continue;
          const nx = next % sampleWidth;
          if (Math.abs(nx - px) > 1) continue;
          visited[next] = 1;
          stack.push(next);
        }
      }

      const width = maxX - minX + 1;
      const height = maxY - minY + 1;
      if (count >= minPixels && width > 12 && height > 8) {
        boxes.push({ x: minX, y: minY, width, height, area: count });
      }
    }
  }
  return mergeBoxes(boxes);
}

function mergeBoxes(boxes) {
  const merged = [];
  for (const box of boxes) {
    const existing = merged.find((item) => overlaps(expand(item, 12), box));
    if (existing) {
      const x1 = Math.min(existing.x, box.x);
      const y1 = Math.min(existing.y, box.y);
      const x2 = Math.max(existing.x + existing.width, box.x + box.width);
      const y2 = Math.max(existing.y + existing.height, box.y + box.height);
      Object.assign(existing, { x: x1, y: y1, width: x2 - x1, height: y2 - y1, area: existing.area + box.area });
    } else {
      merged.push({ ...box });
    }
  }
  return merged;
}

function expand(box, amount) {
  return {
    x: box.x - amount,
    y: box.y - amount,
    width: box.width + amount * 2,
    height: box.height + amount * 2,
  };
}

function overlaps(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function updateTracks(boxes, data, now) {
  const unmatched = new Set(tracks.keys());

  for (const box of boxes) {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    let bestTrack = null;
    let bestDistance = Infinity;

    for (const track of tracks.values()) {
      const distance = Math.hypot(track.cx - cx, track.cy - cy);
      if (distance < bestDistance && distance < 58) {
        bestTrack = track;
        bestDistance = distance;
      }
    }

    if (!bestTrack) {
      bestTrack = {
        id: nextTrackId++,
        firstSeen: now,
        gateATime: null,
        gateBTime: null,
        logged: false,
      };
      tracks.set(bestTrack.id, bestTrack);
    }

    const previousX = bestTrack.cx ?? cx;
    Object.assign(bestTrack, {
      box,
      cx,
      cy,
      color: estimateColor(data, box),
      type: estimateType(box),
      lastSeen: now,
    });
    unmatched.delete(bestTrack.id);
    checkGateCrossing(bestTrack, previousX, cx, now);
  }

  for (const id of unmatched) {
    const track = tracks.get(id);
    if (now - track.lastSeen > maxTrackAge) tracks.delete(id);
  }
  trackCountEl.textContent = String(tracks.size);
}

function checkGateCrossing(track, previousX, currentX, now) {
  const xA = sampleWidth * gateA;
  const xB = sampleWidth * gateB;
  if (!track.gateATime && (crossed(previousX, currentX, xA) || spansGate(track.box, xA))) track.gateATime = now;
  if (!track.gateBTime && (crossed(previousX, currentX, xB) || spansGate(track.box, xB))) track.gateBTime = now;

  if (track.gateATime && track.gateBTime && !track.logged) {
    const seconds = Math.abs(track.gateBTime - track.gateATime) / 1000;
    if (seconds > 0.08) {
      const speed = (Number(distanceMeters.value) / seconds) * 3.6;
      if (speed >= 3 && speed <= 220) {
        track.logged = true;
        track.direction = track.gateATime < track.gateBTime ? "左から右" : "右から左";
        addLog(track, speed);
      }
    }
  }
}

function crossed(a, b, gate) {
  return (a < gate && b >= gate) || (a > gate && b <= gate);
}

function spansGate(box, gate) {
  return box.x <= gate && box.x + box.width >= gate;
}

function estimateColor(data, box) {
  let r = 0;
  let g = 0;
  let b = 0;
  let samples = 0;
  const startX = Math.max(0, Math.floor(box.x + box.width * 0.2));
  const endX = Math.min(sampleWidth, Math.ceil(box.x + box.width * 0.8));
  const startY = Math.max(0, Math.floor(box.y + box.height * 0.2));
  const endY = Math.min(sampleHeight, Math.ceil(box.y + box.height * 0.8));

  for (let y = startY; y < endY; y += 3) {
    for (let x = startX; x < endX; x += 3) {
      const i = (y * sampleWidth + x) * 4;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      samples += 1;
    }
  }

  r = Math.round(r / samples);
  g = Math.round(g / samples);
  b = Math.round(b / samples);
  return { rgb: `rgb(${r}, ${g}, ${b})`, name: colorName(r, g, b) };
}

function colorName(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max < 55) return "黒";
  if (min > 205) return "白";
  if (max - min < 28) return max > 145 ? "銀" : "灰";
  if (r > g * 1.25 && r > b * 1.25) return "赤";
  if (b > r * 1.18 && b > g * 1.08) return "青";
  if (g > r * 1.08 && g > b * 1.08) return "緑";
  if (r > 150 && g > 120 && b < 95) return "黄";
  return "不明";
}

function estimateType(box) {
  const ratio = box.width / Math.max(box.height, 1);
  const area = box.width * box.height;
  if (area > 5600 || (ratio > 2.6 && box.height > 44)) return "トラック/バス";
  if (ratio > 2.9) return "セダン/クーペ";
  if (ratio > 2.1) return "SUV/ワゴン";
  return "小型車";
}

function addLog(track, speed) {
  const snapshot = recordSnapshots.checked ? captureSnapshot(track.box) : "";
  const log = {
    id: crypto.randomUUID(),
    time: new Date(),
    speed: Math.round(speed * 10) / 10,
    color: track.color,
    type: track.type,
    direction: track.direction || "",
    plate: "",
    snapshot,
  };
  logs.unshift(log);
  latestSpeedEl.textContent = `${log.speed} km/h`;
  renderLogs();
  tryPlateOcr(log);
}

function captureSnapshot(box) {
  const scaleX = video.videoWidth / sampleWidth;
  const scaleY = video.videoHeight / sampleHeight;
  const padX = box.width * scaleX * 0.35;
  const padY = box.height * scaleY * 0.45;
  const sx = Math.max(0, box.x * scaleX - padX);
  const sy = Math.max(0, box.y * scaleY - padY);
  const sw = Math.min(video.videoWidth - sx, box.width * scaleX + padX * 2);
  const sh = Math.min(video.videoHeight - sy, box.height * scaleY + padY * 2);
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  const c = canvas.getContext("2d");
  c.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.76);
}

function renderLogs() {
  logCountEl.textContent = String(logs.length);
  recordsEl.replaceChildren();
  for (const log of logs) {
    const item = document.createElement("article");
    item.className = "record";
    item.innerHTML = `
      ${log.snapshot ? `<img src="${log.snapshot}" alt="車両画像">` : `<div class="thumb"></div>`}
      <div>
        <strong>${log.speed} km/h</strong>
        <div class="meta">
          <span class="chip"><span class="swatch" style="background:${log.color.rgb}"></span>${log.color.name}</span>
          <span class="chip">${log.type}</span>
          <span class="chip">${log.direction || "方向不明"}</span>
          <span class="chip">${formatTime(log.time)}</span>
        </div>
        <div class="plate-row">
          <input value="${escapeHtml(log.plate)}" data-id="${log.id}" placeholder="ナンバー">
          <button data-edit="${log.id}">保存</button>
        </div>
      </div>
    `;
    recordsEl.append(item);
  }

  recordsEl.querySelectorAll("[data-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.edit;
      const input = recordsEl.querySelector(`input[data-id="${id}"]`);
      const log = logs.find((entry) => entry.id === id);
      if (!log) return;
      log.plate = input.value.trim();
      selectedLogId = id;
      plateInput.value = log.plate;
      platePreview.src = log.snapshot || "";
      plateEditor.hidden = !log.snapshot;
      renderLogs();
    });
  });
}

function drawOverlay(now) {
  const width = overlay.clientWidth;
  const height = overlay.clientHeight;
  ctx.clearRect(0, 0, width, height);
  drawGate(width * gateA, "#2d6cdf", "A");
  drawGate(width * gateB, "#b13f2f", "B");

  const scaleX = width / sampleWidth;
  const scaleY = height / sampleHeight;
  for (const track of tracks.values()) {
    if (!track.box || now - track.lastSeen > maxTrackAge) continue;
    const x = track.box.x * scaleX;
    const y = track.box.y * scaleY;
    const w = track.box.width * scaleX;
    const h = track.box.height * scaleY;

    if (showDebug.checked) {
      ctx.strokeStyle = track.gateATime ? "#b13f2f" : "#2d6cdf";
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
    }
    ctx.fillStyle = "rgba(0, 0, 0, 0.62)";
    ctx.fillRect(x, Math.max(0, y - 28), 128, 24);
    ctx.fillStyle = "#fff";
    ctx.font = "13px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    ctx.fillText(`${track.type} ${track.color.name}`, x + 8, Math.max(16, y - 11));
  }
}

function drawGate(y, color, label) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.setLineDash([14, 10]);
  ctx.beginPath();
  ctx.moveTo(y, 0);
  ctx.lineTo(y, overlay.clientHeight);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = color;
  ctx.fillRect(y - 17, 14, 34, 24);
  ctx.fillStyle = "#fff";
  ctx.font = "700 13px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  ctx.fillText(label, y - 4, 31);
}

function exportCsv() {
  const rows = [["time", "speed_kmh", "plate", "color", "type", "direction"]];
  for (const log of logs) {
    rows.push([log.time.toISOString(), log.speed, log.plate, log.color.name, log.type, log.direction]);
  }
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `road-speed-logs-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function tryPlateOcr(log) {
  if (!log.snapshot || !("TextDetector" in window)) return;
  try {
    const detector = new TextDetector();
    const image = await createImageBitmap(await (await fetch(log.snapshot)).blob());
    const results = await detector.detect(image);
    const text = results
      .map((item) => item.rawValue)
      .join(" ")
      .replace(/[^\p{L}\p{N}\-\s]/gu, "")
      .trim();
    if (!text) return;
    log.plate = text;
    renderLogs();
  } catch (error) {
    console.debug("Plate OCR unavailable", error);
  }
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function formatTime(date) {
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char]));
}

addEventListener("resize", resizeCanvases);
showMobileNotice();
