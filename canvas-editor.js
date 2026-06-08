// Canvas編集ロジック（レイヤー合成・配置物のドラッグ操作・手書き）

class CanvasEditor {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    this.baseImage = null;     // 元写真 (Image)
    this.filter = FILTERS[0];  // 現在のフィルター
    this.frame = null;         // { image, holed, rect } | null（rectは0〜1の相対窓枠位置）
    this.framePhotoTransform = { scale: 1, offsetX: 0, offsetY: 0 }; // 窓枠内での写真の拡大・移動
    this.bgColor = '#ffffff';  // 写真の外側に敷く背景色

    this.stamps = [];          // {img, x, y, size, id}
    this.texts = [];           // {text, x, y, font, size, color, stroke, shadow, id}
    this._nextId = 1;

    // 手書き用オフスクリーンレイヤー
    this.drawLayer = document.createElement('canvas');
    this.drawCtx = this.drawLayer.getContext('2d');
    this.undoStack = [];

    this.tool = 'pen';         // 'pen' | 'eraser'
    this.penColor = '#ff5fa2';
    this.penWidth = 6;
    this.penStyle = 'normal';  // 'normal' | 'outline' | 'puffy' | 'translucent' | 'double'

    this.activeTab = 'draw';
    this.frameAdjustMode = false; // true の間はキャンバスのドラッグで写真の位置を調整できる
    this._dragTarget = null;
    this._dragOffset = { x: 0, y: 0 };
    this._isDrawing = false;
    this._strokeSnapshot = null;
    this._strokePoints = null;

    this._bindPointerEvents();
  }

  setImage(image) {
    this.baseImage = image;
    this.filter = FILTERS[0];
    this.framePhotoTransform = { scale: 1, offsetX: 0, offsetY: 0 };
    this._layoutCanvas();
    this.render();
  }

  setFilter(filter) {
    this.filter = filter;
    this.render();
  }

  // フレームを選択。rect は窓枠の位置・サイズ（画像サイズに対する0〜1の相対値）
  setFrame(image, rect) {
    this.frame = image ? { image, holed: this._punchFrameHole(image, rect), rect } : null;
    this.framePhotoTransform = { scale: 1, offsetX: 0, offsetY: 0 };
    this._layoutCanvas();
    this.render();
  }

  setFrameAdjustMode(on) {
    this.frameAdjustMode = on;
  }

  setFramePhotoScale(scale) {
    this.framePhotoTransform.scale = scale;
    this.render();
  }

  // 窓枠 dw×dh いっぱいに写真を「カバー」表示しつつ、ユーザーの拡大率・位置調整を反映した合成キャンバスを作る
  _composeFramePhoto(dw, dh) {
    const img = this.baseImage;
    const iw = img.width;
    const ih = img.height;
    const t = this.framePhotoTransform;
    const baseScale = Math.max(dw / iw, dh / ih);
    const scale = baseScale * t.scale;
    const drawW = iw * scale;
    const drawH = ih * scale;
    const dx = (dw - drawW) / 2 + t.offsetX;
    const dy = (dh - drawH) / 2 + t.offsetY;
    const off = document.createElement('canvas');
    off.width = dw;
    off.height = dh;
    const octx = off.getContext('2d');
    octx.drawImage(img, dx, dy, drawW, drawH);
    return off;
  }

  // フレーム画像の窓枠部分を透明にくり抜いたキャンバスを作る（写真がそこに透けて見えるように）
  _punchFrameHole(image, rect) {
    const off = document.createElement('canvas');
    off.width = image.width;
    off.height = image.height;
    const octx = off.getContext('2d');
    octx.drawImage(image, 0, 0);
    octx.clearRect(
      rect.x * image.width,
      rect.y * image.height,
      rect.w * image.width,
      rect.h * image.height
    );
    return off;
  }

  // キャンバスサイズを決める（フレームがあればフレームの縦横比、なければ写真の縦横比）
  _layoutCanvas() {
    const maxSide = 1000;
    let w, h;
    if (this.frame) {
      w = this.frame.image.width;
      h = this.frame.image.height;
    } else if (this.baseImage) {
      w = this.baseImage.width;
      h = this.baseImage.height;
    } else {
      return;
    }
    if (Math.max(w, h) > maxSide) {
      const scale = maxSide / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }
    this.canvas.width = w;
    this.canvas.height = h;
    this.drawLayer.width = w;
    this.drawLayer.height = h;
    this.drawCtx.clearRect(0, 0, w, h);
    this.undoStack = [];
    this.stamps = [];
    this.texts = [];
  }

  setBgColor(color) {
    this.bgColor = color;
    this.render();
  }

  addStamp(image) {
    const size = Math.round(Math.min(this.canvas.width, this.canvas.height) * 0.22);
    this.stamps.push({
      img: image,
      x: this.canvas.width / 2 - size / 2,
      y: this.canvas.height / 2 - size / 2,
      size,
      id: this._nextId++
    });
    this.render();
  }

  addText(opts) {
    this.texts.push({
      text: opts.text,
      x: this.canvas.width / 2,
      y: this.canvas.height / 2,
      font: opts.font,
      size: opts.size,
      color: opts.color,
      stroke: opts.stroke,
      shadow: opts.shadow,
      id: this._nextId++
    });
    this.render();
  }

  setTool(tool) { this.tool = tool; }
  setPenColor(c) { this.penColor = c; }
  setPenWidth(w) { this.penWidth = w; }
  setPenStyle(style) { this.penStyle = style; }

  setActiveTab(tab) { this.activeTab = tab; }

  clearDrawing() {
    this._pushUndo();
    this.drawCtx.clearRect(0, 0, this.drawLayer.width, this.drawLayer.height);
    this.render();
  }

  undo() {
    if (this.undoStack.length === 0) return;
    const snapshot = this.undoStack.pop();
    this.drawCtx.putImageData(snapshot, 0, 0);
    this.render();
  }

  // ---- 描画 ----
  render() {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    if (!w || !h) return;

    ctx.clearRect(0, 0, w, h);

    // 背景色（写真の外側や透明部分に敷く色）
    ctx.fillStyle = this.bgColor;
    ctx.fillRect(0, 0, w, h);

    if (this.frame) {
      // フレームありの場合：写真は窓枠の中に「カバー」表示し、その上にくり抜き済みフレームを重ねる
      const r = this.frame.rect;
      const rx = Math.round(r.x * w);
      const ry = Math.round(r.y * h);
      const rw = Math.round(r.w * w);
      const rh = Math.round(r.h * h);
      if (this.baseImage) {
        const composed = this._composeFramePhoto(rw, rh);
        ctx.save();
        ctx.translate(rx, ry);
        this.filter.draw(ctx, composed, rw, rh);
        ctx.restore();
      }
      ctx.drawImage(this.frame.holed, 0, 0, w, h);
    } else if (this.baseImage) {
      // 背景画像 + フィルター
      this.filter.draw(ctx, this.baseImage, w, h);
    }

    // スタンプ
    for (const s of this.stamps) {
      ctx.drawImage(s.img, s.x, s.y, s.size, s.size);
    }

    // 手書きレイヤー
    ctx.drawImage(this.drawLayer, 0, 0);

    // テキスト
    for (const t of this.texts) {
      ctx.save();
      ctx.font = `bold ${t.size}px ${t.font}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (t.shadow) {
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 8;
        ctx.shadowOffsetY = 3;
      }
      if (t.stroke) {
        ctx.lineWidth = Math.max(2, t.size * 0.12);
        ctx.strokeStyle = t.stroke;
        ctx.strokeText(t.text, t.x, t.y);
      }
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
      ctx.restore();
    }
  }

  // ---- ポインター操作（ドラッグ配置・削除・手書き）----
  _bindPointerEvents() {
    const canvas = this.canvas;
    canvas.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this._onPointerMove(e));
    window.addEventListener('pointerup', (e) => this._onPointerUp(e));
    canvas.addEventListener('dblclick', (e) => this._onDoubleClick(e));
  }

  _toCanvasCoords(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  }

  _hitTestStamp(x, y) {
    for (let i = this.stamps.length - 1; i >= 0; i--) {
      const s = this.stamps[i];
      if (x >= s.x && x <= s.x + s.size && y >= s.y && y <= s.y + s.size) return s;
    }
    return null;
  }

  _hitTestText(x, y) {
    const ctx = this.ctx;
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      ctx.font = `bold ${t.size}px ${t.font}`;
      const metrics = ctx.measureText(t.text);
      const halfW = metrics.width / 2;
      const halfH = t.size / 2;
      if (x >= t.x - halfW && x <= t.x + halfW && y >= t.y - halfH && y <= t.y + halfH) return t;
    }
    return null;
  }

  _onPointerDown(e) {
    if (!this.baseImage) return;
    const { x, y } = this._toCanvasCoords(e);

    if (this.activeTab === 'draw') {
      this._isDrawing = true;
      this._pushUndo();
      this._strokeSnapshot = this.drawCtx.getImageData(0, 0, this.drawLayer.width, this.drawLayer.height);
      this._strokePoints = [{ x, y }];
      this._redrawStroke();
      return;
    }

    // 位置調整モード：ドラッグで窓枠内の写真位置を調整
    if (this.frameAdjustMode && this.frame) {
      this._isPanningPhoto = true;
      this._panStart = {
        x, y,
        offsetX: this.framePhotoTransform.offsetX,
        offsetY: this.framePhotoTransform.offsetY
      };
      this.canvas.setPointerCapture(e.pointerId);
      return;
    }

    // スタンプ / テキストのドラッグ判定（追加した上のレイヤーから優先）
    const text = this._hitTestText(x, y);
    if (text) {
      this._dragTarget = { kind: 'text', obj: text };
      this._dragOffset = { x: x - text.x, y: y - text.y };
      this.canvas.setPointerCapture(e.pointerId);
      return;
    }
    const stamp = this._hitTestStamp(x, y);
    if (stamp) {
      this._dragTarget = { kind: 'stamp', obj: stamp };
      this._dragOffset = { x: x - stamp.x, y: y - stamp.y };
      this.canvas.setPointerCapture(e.pointerId);
    }
  }

  _onPointerMove(e) {
    if (!this.baseImage) return;
    const { x, y } = this._toCanvasCoords(e);

    if (this._isDrawing) {
      this._strokePoints.push({ x, y });
      this._redrawStroke();
      return;
    }

    if (this._isPanningPhoto) {
      this.framePhotoTransform.offsetX = this._panStart.offsetX + (x - this._panStart.x);
      this.framePhotoTransform.offsetY = this._panStart.offsetY + (y - this._panStart.y);
      this.render();
      return;
    }

    if (this._dragTarget) {
      const { kind, obj } = this._dragTarget;
      obj.x = x - this._dragOffset.x;
      obj.y = y - this._dragOffset.y;
      this.render();
    }
  }

  _onPointerUp() {
    this._isDrawing = false;
    this._strokeSnapshot = null;
    this._strokePoints = null;
    this._isPanningPhoto = false;
    this._panStart = null;
    this._dragTarget = null;
  }

  _onDoubleClick(e) {
    if (!this.baseImage || this.activeTab === 'draw') return;
    const { x, y } = this._toCanvasCoords(e);

    const text = this._hitTestText(x, y);
    if (text) {
      this.texts = this.texts.filter(t => t !== text);
      this.render();
      return;
    }
    const stamp = this._hitTestStamp(x, y);
    if (stamp) {
      this.stamps = this.stamps.filter(s => s !== stamp);
      this.render();
    }
  }

  // ---- 手書き描画 ----
  _pushUndo() {
    const { width, height } = this.drawLayer;
    if (!width || !height) return;
    this.undoStack.push(this.drawCtx.getImageData(0, 0, width, height));
    if (this.undoStack.length > 20) this.undoStack.shift();
  }

  // ストローク中のプレビューを描き直す。
  // ストローク開始時のスナップショットに毎回戻してから全体のパスを描画することで、
  // 半透明・縁取りなどの「線が重なって濃くなる/欠ける」問題を防ぐ。
  _redrawStroke() {
    if (!this._strokeSnapshot) return;
    this.drawCtx.putImageData(this._strokeSnapshot, 0, 0);

    const points = this._strokePoints;
    if (this.tool === 'eraser') {
      this._paintEraserPath(points);
    } else {
      this._paintPenPath(points);
    }
    this.render();
  }

  _tracePath(ctx, points, dx = 0, dy = 0) {
    ctx.beginPath();
    if (points.length === 1) {
      ctx.moveTo(points[0].x + dx, points[0].y + dy);
      ctx.lineTo(points[0].x + dx, points[0].y + dy);
    } else {
      ctx.moveTo(points[0].x + dx, points[0].y + dy);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x + dx, points[i].y + dy);
      }
    }
  }

  _paintEraserPath(points) {
    const ctx = this.drawCtx;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = this.penWidth;
    this._tracePath(ctx, points);
    ctx.stroke();
    ctx.restore();
  }

  // ペンの種類ごとの描画処理（ノーマル/縁取り/ぷっくり/半透明/二重）
  _paintPenPath(points) {
    const ctx = this.drawCtx;
    const w = this.penWidth;
    const color = this.penColor;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const strokePath = (lineWidth, strokeStyle, alpha = 1, dx = 0, dy = 0) => {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidth;
      this._tracePath(ctx, points, dx, dy);
      ctx.stroke();
    };

    switch (this.penStyle) {
      case 'outline':
        strokePath(w + Math.max(2, w * 0.5), '#ffffff', 1);
        strokePath(w, color, 1);
        break;

      case 'puffy': {
        const offset = w * 0.18;
        strokePath(w, color, 1);
        strokePath(Math.max(1, w * 0.4), 'rgba(255,255,255,0.65)', 1, -offset, -offset);
        break;
      }

      case 'translucent':
        strokePath(w, color, 0.4);
        break;

      case 'double': {
        const offset = w * 0.45;
        strokePath(Math.max(1, w * 0.45), color, 1, -offset, -offset);
        strokePath(Math.max(1, w * 0.45), color, 1, offset, offset);
        break;
      }

      case 'normal':
      default:
        strokePath(w, color, 1);
        break;
    }

    ctx.restore();
  }

  // ---- 出力 ----
  toDataURL() {
    return this.canvas.toDataURL('image/png');
  }
}
