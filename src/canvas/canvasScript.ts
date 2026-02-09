// This script runs inside the webview (browser context, no Node APIs).

interface Camera {
  x: number;
  y: number;
  zoom: number;
}

interface PdkData {
  cells: { name: string }[];
  connectivity: { name: string }[];
}

interface DocumentData {
  version: number;
  components: unknown[];
  junctions: unknown[];
  wires: unknown[];
}

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

const canvas = document.getElementById("ofaCanvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const componentSelect = document.getElementById("componentSelect") as HTMLSelectElement;
const junctionSelect = document.getElementById("junctionSelect") as HTMLSelectElement;

const camera: Camera = { x: 0, y: 0, zoom: 1 };
let spaceHeld = false;
let isPanning = false;
let panStart = { x: 0, y: 0 };
let documentData: DocumentData | null = null;

// --- Resize ---

function resizeCanvas(): void {
  const container = canvas.parentElement!;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = container.clientWidth * dpr;
  canvas.height = container.clientHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

const resizeObserver = new ResizeObserver(() => resizeCanvas());
resizeObserver.observe(canvas.parentElement!);
resizeCanvas();

// --- Grid ---

function drawGrid(w: number, h: number): void {
  const gridSize = 20;

  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
  ctx.lineWidth = 1 / camera.zoom;

  const left = -camera.x / camera.zoom;
  const top = -camera.y / camera.zoom;
  const right = left + w / camera.zoom;
  const bottom = top + h / camera.zoom;

  const startX = Math.floor(left / gridSize) * gridSize;
  const startY = Math.floor(top / gridSize) * gridSize;

  ctx.beginPath();
  for (let x = startX; x <= right; x += gridSize) {
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
  }
  for (let y = startY; y <= bottom; y += gridSize) {
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
  }
  ctx.stroke();

  // Major grid every 5 cells
  const majorSize = gridSize * 5;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  const majorStartX = Math.floor(left / majorSize) * majorSize;
  const majorStartY = Math.floor(top / majorSize) * majorSize;

  ctx.beginPath();
  for (let x = majorStartX; x <= right; x += majorSize) {
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
  }
  for (let y = majorStartY; y <= bottom; y += majorSize) {
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
  }
  ctx.stroke();
  ctx.restore();
}

// --- Origin crosshair ---

function drawOrigin(): void {
  ctx.save();
  ctx.strokeStyle = "rgba(255, 100, 100, 0.3)";
  ctx.lineWidth = 1 / camera.zoom;
  const size = 30 / camera.zoom;
  ctx.beginPath();
  ctx.moveTo(-size, 0);
  ctx.lineTo(size, 0);
  ctx.moveTo(0, -size);
  ctx.lineTo(0, size);
  ctx.stroke();
  ctx.restore();
}

// --- Render loop ---

function render(): void {
  const container = canvas.parentElement!;
  const w = container.clientWidth;
  const h = container.clientHeight;

  ctx.clearRect(0, 0, w, h);

  ctx.save();
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.zoom, camera.zoom);

  drawGrid(w, h);
  drawOrigin();

  // TODO: draw components, junctions, wires from documentData

  ctx.restore();

  requestAnimationFrame(render);
}

requestAnimationFrame(render);

// --- Pan (Space + Click) ---

document.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    spaceHeld = true;
    canvas.style.cursor = "grab";
    e.preventDefault();
  }
});

document.addEventListener("keyup", (e) => {
  if (e.code === "Space") {
    spaceHeld = false;
    isPanning = false;
    canvas.style.cursor = "default";
  }
});

canvas.addEventListener("mousedown", (e) => {
  if (spaceHeld) {
    isPanning = true;
    panStart = { x: e.clientX - camera.x, y: e.clientY - camera.y };
    canvas.style.cursor = "grabbing";
  }
});

canvas.addEventListener("mousemove", (e) => {
  if (isPanning) {
    camera.x = e.clientX - panStart.x;
    camera.y = e.clientY - panStart.y;
  }
});

canvas.addEventListener("mouseup", () => {
  if (isPanning) {
    isPanning = false;
    canvas.style.cursor = spaceHeld ? "grab" : "default";
  }
});

// --- Zoom (Scroll) ---

canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    camera.x = mx - (mx - camera.x) * zoomFactor;
    camera.y = my - (my - camera.y) * zoomFactor;
    camera.zoom *= zoomFactor;
    camera.zoom = Math.max(0.1, Math.min(10, camera.zoom));
  },
  { passive: false }
);

// --- Message handling ---

function populateSelect(select: HTMLSelectElement, items: { name: string }[], placeholder: string): void {
  select.innerHTML = "";
  const defaultOpt = document.createElement("option");
  defaultOpt.value = "";
  defaultOpt.textContent = placeholder;
  select.appendChild(defaultOpt);
  for (const item of items) {
    const opt = document.createElement("option");
    opt.value = item.name;
    opt.textContent = item.name;
    select.appendChild(opt);
  }
}

window.addEventListener("message", (e) => {
  const msg = e.data;
  switch (msg.type) {
    case "update":
      documentData = msg.data as DocumentData;
      break;
    case "pdkData": {
      const pdk = msg as unknown as { type: string } & PdkData;
      populateSelect(componentSelect, pdk.cells, "-- Select Device --");
      populateSelect(junctionSelect, pdk.connectivity, "-- Select Junction --");
      break;
    }
  }
});

// Notify extension that webview is ready
vscode.postMessage({ type: "ready" });
