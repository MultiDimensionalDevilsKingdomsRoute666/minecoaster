/**
 * Title screen + in-ride HUD. The MINECOASTER logo is rendered as beveled
 * "blocks" on a canvas from a built-in 5x5 pixel font — no fonts or images.
 */

const GLYPHS: Record<string, string[]> = {
  M: ['X...X', 'XX.XX', 'X.X.X', 'X...X', 'X...X'],
  I: ['XXXXX', '..X..', '..X..', '..X..', 'XXXXX'],
  N: ['X...X', 'XX..X', 'X.X.X', 'X..XX', 'X...X'],
  E: ['XXXXX', 'X....', 'XXXX.', 'X....', 'XXXXX'],
  C: ['.XXXX', 'X....', 'X....', 'X....', '.XXXX'],
  O: ['.XXX.', 'X...X', 'X...X', 'X...X', '.XXX.'],
  A: ['.XXX.', 'X...X', 'XXXXX', 'X...X', 'X...X'],
  S: ['.XXXX', 'X....', '.XXX.', '....X', 'XXXX.'],
  T: ['XXXXX', '..X..', '..X..', '..X..', '..X..'],
  R: ['XXXX.', 'X...X', 'XXXX.', 'X..X.', 'X...X'],
};

interface LogoLine {
  text: string;
  topColor: string;
  bottomColor: string;
}

/** Render text lines as chunky beveled pixel-blocks. */
export function renderLogoCanvas(lines: LogoLine[], pixelSize = 8): HTMLCanvasElement {
  const glyphW = 6; // 5px glyph + 1px spacing
  const lineH = 7;
  const widest = Math.max(...lines.map((l) => l.text.length * glyphW - 1));
  const canvas = document.createElement('canvas');
  canvas.width = widest * pixelSize;
  canvas.height = (lines.length * lineH - 2) * pixelSize;
  const ctx = canvas.getContext('2d')!;

  lines.forEach((line, lineIdx) => {
    const lineWidth = line.text.length * glyphW - 1;
    const xOffset = Math.floor((widest - lineWidth) / 2);
    const yOffset = lineIdx * lineH;
    for (let c = 0; c < line.text.length; c++) {
      const glyph = GLYPHS[line.text[c]];
      if (!glyph) continue;
      for (let gy = 0; gy < 5; gy++) {
        for (let gx = 0; gx < 5; gx++) {
          if (glyph[gy][gx] !== 'X') continue;
          const px = (xOffset + c * glyphW + gx) * pixelSize;
          const py = (yOffset + gy) * pixelSize;
          const t = gy / 4;
          ctx.fillStyle = mixColors(line.topColor, line.bottomColor, t);
          ctx.fillRect(px, py, pixelSize, pixelSize);
          // beveled block: light top-left edge, dark bottom-right edge
          ctx.fillStyle = 'rgba(255,255,255,0.35)';
          ctx.fillRect(px, py, pixelSize, Math.ceil(pixelSize / 4));
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.fillRect(px, py + pixelSize - Math.ceil(pixelSize / 4), pixelSize, Math.ceil(pixelSize / 4));
        }
      }
    }
  });
  return canvas;
}

function mixColors(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
  const g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
  const bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
  return `rgb(${r},${g},${bl})`;
}

const HUD_CSS = `
  #mc-ui { position: absolute; inset: 0; pointer-events: none; user-select: none;
    font-family: 'Courier New', monospace; color: #fff; overflow: hidden; }
  #mc-title { position: absolute; inset: 0; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 28px;
    background: rgba(8, 10, 18, 0.55); pointer-events: auto; transition: opacity 0.6s; }
  #mc-title.hidden { opacity: 0; pointer-events: none; }
  #mc-logo { image-rendering: pixelated; width: min(72vw, 560px);
    animation: mc-bob 2.4s ease-in-out infinite;
    filter: drop-shadow(4px 6px 0 rgba(0,0,0,0.5)); }
  @keyframes mc-bob { 0%,100% { transform: translateY(0) rotate(-1deg); }
    50% { transform: translateY(-10px) rotate(1deg); } }
  #mc-tagline { font-size: 15px; letter-spacing: 2px; color: #9be564; text-shadow: 2px 2px 0 #000; }
  #mc-ride { font-family: inherit; font-weight: bold; font-size: 26px; letter-spacing: 4px;
    padding: 14px 46px; cursor: pointer; color: #fff; background: #3fa33f;
    border: none; box-shadow: 0 6px 0 #1e5c1e, inset 0 3px 0 rgba(255,255,255,0.3),
      inset -3px 0 0 rgba(0,0,0,0.15), inset 3px 0 0 rgba(255,255,255,0.15);
    text-shadow: 2px 2px 0 #1e5c1e; image-rendering: pixelated; }
  #mc-ride:hover { background: #4cbf4c; transform: translateY(-2px); box-shadow: 0 8px 0 #1e5c1e,
    inset 0 3px 0 rgba(255,255,255,0.3); }
  #mc-ride:active { transform: translateY(4px); box-shadow: 0 2px 0 #1e5c1e; }
  #mc-keys { font-size: 12px; color: #aab; text-shadow: 1px 1px 0 #000; letter-spacing: 1px; }
  #mc-hud { position: absolute; left: 16px; bottom: 14px; display: none;
    flex-direction: column; gap: 4px; font-size: 14px; text-shadow: 2px 2px 0 #000;
    background: rgba(0,0,0,0.35); padding: 10px 14px; border: 2px solid rgba(255,255,255,0.25); }
  #mc-hud.visible { display: flex; }
  #mc-hud .mc-big { font-size: 22px; font-weight: bold; color: #ffe27a; }
  #mc-lapbox { position: absolute; right: 16px; top: 14px; display: none; font-size: 18px;
    font-weight: bold; text-shadow: 2px 2px 0 #000; background: rgba(0,0,0,0.35);
    padding: 8px 14px; border: 2px solid rgba(255,255,255,0.25); }
  #mc-lapbox.visible { display: block; }
  #mc-hints { position: absolute; right: 16px; bottom: 14px; display: none; font-size: 12px;
    color: #ccd; text-shadow: 1px 1px 0 #000; text-align: right; line-height: 1.7; }
  #mc-hints.visible { display: block; }
  #mc-toast { position: absolute; top: 18%; left: 50%; transform: translateX(-50%);
    font-size: 30px; font-weight: bold; letter-spacing: 3px; color: #ffe27a;
    text-shadow: 3px 3px 0 #000; opacity: 0; transition: opacity 0.3s, transform 0.3s; }
  #mc-toast.show { opacity: 1; transform: translateX(-50%) scale(1.15); }
`;

export interface HudStats {
  speed: number;
  height: number;
  g: number;
  lap: number;
  camera: string;
  muted: boolean;
}

export interface HudCallbacks {
  onStart: () => void;
  onCycleCamera: () => void;
  onToggleMute: () => void;
}

export class Hud {
  private titleEl: HTMLElement;
  private hudEl: HTMLElement;
  private lapEl: HTMLElement;
  private hintsEl: HTMLElement;
  private toastEl: HTMLElement;
  private speedEl: HTMLElement;
  private statEls: { height: HTMLElement; g: HTMLElement; cam: HTMLElement; mute: HTMLElement };
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(root: HTMLElement, cb: HudCallbacks) {
    const style = document.createElement('style');
    style.textContent = HUD_CSS;
    document.head.appendChild(style);

    const ui = document.createElement('div');
    ui.id = 'mc-ui';
    ui.innerHTML = `
      <div id="mc-title">
        <div id="mc-tagline">EVERY PIXEL GENERATED &bull; NO ASSETS HARMED</div>
        <button id="mc-ride">&#9654; RIDE</button>
        <div id="mc-keys">C &mdash; camera &nbsp;&nbsp; M &mdash; mute &nbsp;&nbsp; SPACE &mdash; ride</div>
      </div>
      <div id="mc-hud">
        <div class="mc-big"><span id="mc-speed">0.0</span> m/s</div>
        <div>height <span id="mc-height">0</span>m &nbsp; g-force <span id="mc-g">1.0</span></div>
      </div>
      <div id="mc-lapbox">LAP <span id="mc-lap">0</span></div>
      <div id="mc-hints">[C] camera: <span id="mc-cam">onboard</span><br>[M] sound: <span id="mc-mute">on</span></div>
      <div id="mc-toast"></div>
    `;
    root.appendChild(ui);

    const logo = renderLogoCanvas([
      { text: 'MINE', topColor: '#8fe05a', bottomColor: '#3f7a23' },
      { text: 'COASTER', topColor: '#ffb84d', bottomColor: '#c43c2a' },
    ]);
    logo.id = 'mc-logo';
    const title = ui.querySelector<HTMLElement>('#mc-title')!;
    title.prepend(logo);

    this.titleEl = title;
    this.hudEl = ui.querySelector('#mc-hud')!;
    this.lapEl = ui.querySelector('#mc-lapbox')!;
    this.hintsEl = ui.querySelector('#mc-hints')!;
    this.toastEl = ui.querySelector('#mc-toast')!;
    this.speedEl = ui.querySelector('#mc-speed')!;
    this.statEls = {
      height: ui.querySelector('#mc-height')!,
      g: ui.querySelector('#mc-g')!,
      cam: ui.querySelector('#mc-cam')!,
      mute: ui.querySelector('#mc-mute')!,
    };

    ui.querySelector<HTMLButtonElement>('#mc-ride')!.addEventListener('click', cb.onStart);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyC') cb.onCycleCamera();
      else if (e.code === 'KeyM') cb.onToggleMute();
      else if (e.code === 'Space') cb.onStart();
    });
  }

  hideTitle(): void {
    this.titleEl.classList.add('hidden');
    this.hudEl.classList.add('visible');
    this.lapEl.classList.add('visible');
    this.hintsEl.classList.add('visible');
  }

  setStats(stats: HudStats): void {
    this.speedEl.textContent = stats.speed.toFixed(1);
    this.statEls.height.textContent = Math.round(stats.height).toString();
    this.statEls.g.textContent = stats.g.toFixed(1);
    document.getElementById('mc-lap')!.textContent = stats.lap.toString();
    this.statEls.cam.textContent = stats.camera;
    this.statEls.mute.textContent = stats.muted ? 'off' : 'on';
  }

  toast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), 1600);
  }
}
