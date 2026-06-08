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
    this.redoStack = [];
    this.onUndoStackChange = null; // 戻す/やり直すボタンの有効・無効表示の更新用コールバック

    this.tool = 'pen';         // 'pen' | 'eraser'
    this.penColor = '#ff5fa2';
    this.penWidth = 6;
    this.penStyle = 'normal';  // 'normal' | 'outline' | 'puffy' | 'translucent' | 'double'

    this.activeTab = 'draw';
    this.frameAdjustMode = false; // true の間はキャンバスのドラッグで写真の位置を調整できる
    this.onFrameScaleChange = null; // ピンチ操作でスケールが変わった時にスライダー側へ通知するコールバック

    this.selectedObject = null; // { kind: 'stamp'|'text', obj } 選択中の配置物（リサイズ・回転ハンドル表示用）
    this._dragTarget = null;
    this._dragOffset = { x: 0, y: 0 };
    this._handleMode = null; // 'resize' | 'rotate'
    this._handleStart = null;
    this._isDrawing = false;
    this._strokeSnapshot = null;
    this._strokePoints = null;

    // 写真位置調整中のピンチ操作（マルチタッチ）用
    this._activePointers = new Map(); // pointerId -> {x, y}
    this._pinchStart = null; // { dist, scale }
    this._isPanningPhoto = false;
    this._panStart = null;

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

  setFramePhotoScale(scale, opts = {}) {
    this.framePhotoTransform.scale = scale;
    if (!opts.silent && this.onFrameScaleChange) this.onFrameScaleChange(scale);
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
    this.redoStack = [];
    this._notifyUndoStackChange();
    this.stamps = [];
    this.texts = [];
    this.selectedObject = null;
  }

  setBgColor(color) {
    this.bgColor = color;
    this.render();
  }

  addStamp(image) {
    const size = Math.round(Math.min(this.canvas.width, this.canvas.height) * 0.22);
    const stamp = {
      img: image,
      x: this.canvas.width / 2 - size / 2,
      y: this.canvas.height / 2 - size / 2,
      size,
      rotation: 0,
      id: this._nextId++
    };
    this.stamps.push(stamp);
    this.selectedObject = { kind: 'stamp', obj: stamp };
    this.render();
  }

  addText(opts) {
    const text = {
      text: opts.text,
      x: this.canvas.width / 2,
      y: this.canvas.height / 2,
      font: opts.font,
      size: opts.size,
      color: opts.color,
      stroke: opts.stroke,
      shadow: opts.shadow,
      rotation: 0,
      id: this._nextId++
    };
    this.texts.push(text);
    this.selectedObject = { kind: 'text', obj: text };
    this.render();
  }

  setTool(tool) { this.tool = tool; }
  setPenColor(c) { this.penColor = c; }
  setPenWidth(w) { this.penWidth = w; }
  setPenStyle(style) { this.penStyle = style; }

  setActiveTab(tab) {
    this.activeTab = tab;
    this.selectedObject = null;
    this.render();
  }

  _notifyUndoStackChange() {
    if (this.onUndoStackChange) {
      this.onUndoStackChange(this.undoStack.length, this.redoStack.length);
    }
  }

  clearDrawing() {
    this._pushUndo();
    this.drawCtx.clearRect(0, 0, this.drawLayer.width, this.drawLayer.height);
    this.render();
  }

  undo() {
    if (this.undoStack.length === 0) return;
    const { width, height } = this.drawLayer;
    this.redoStack.push(this.drawCtx.getImageData(0, 0, width, height));
    if (this.redoStack.length > 20) this.redoStack.shift();
    const snapshot = this.undoStack.pop();
    this.drawCtx.putImageData(snapshot, 0, 0);
    this._notifyUndoStackChange();
    this.render();
  }

  redo() {
    if (this.redoStack.length === 0) return;
    const { width, height } = this.drawLayer;
    this.undoStack.push(this.drawCtx.getImageData(0, 0, width, height));
    if (this.undoStack.length > 20) this.undoStack.shift();
    const snapshot = this.redoStack.pop();
    this.drawCtx.putImageData(snapshot, 0, 0);
    this._notifyUndoStackChange();
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
      ctx.save();
      ctx.translate(s.x + s.size / 2, s.y + s.size / 2);
      ctx.rotate(s.rotation || 0);
      ctx.drawImage(s.img, -s.size / 2, -s.size / 2, s.size, s.size);
      ctx.restore();
    }

    // 手書きレイヤー
    ctx.drawImage(this.drawLayer, 0, 0);

    // テキスト
    for (const t of this.texts) {
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.rotate(t.rotation || 0);
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
        ctx.strokeText(t.text, 0, 0);
      }
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, 0, 0);
      ctx.restore();
    }

    // 選択中の配置物：枠とリサイズ・回転ハンドルを表示
    if (this.selectedObject && this.activeTab !== 'draw') {
      this._drawSelectionHandles(this.selectedObject);
    }
  }

  // ---- 配置物の選択・変形（バウンディングボックス計算・ハンドル）----
  _getObjBounds({ kind, obj }) {
    if (kind === 'stamp') {
      return {
        cx: obj.x + obj.size / 2,
        cy: obj.y + obj.size / 2,
        halfW: obj.size / 2,
        halfH: obj.size / 2,
        rotation: obj.rotation || 0
      };
    }
    this.ctx.font = `bold ${obj.size}px ${obj.font}`;
    const halfW = Math.max(this.ctx.measureText(obj.text).width / 2, obj.size / 2);
    return {
      cx: obj.x,
      cy: obj.y,
      halfW,
      halfH: obj.size / 2,
      rotation: obj.rotation || 0
    };
  }

  // ローカル座標（オブジェクト中心からのオフセット）をワールド座標に変換
  _localToWorld(bounds, lx, ly) {
    const cos = Math.cos(bounds.rotation);
    const sin = Math.sin(bounds.rotation);
    return {
      x: bounds.cx + lx * cos - ly * sin,
      y: bounds.cy + lx * sin + ly * cos
    };
  }

  // ワールド座標をオブジェクトのローカル座標（回転を打ち消した座標系）に変換
  _worldToLocal(bounds, wx, wy) {
    const dx = wx - bounds.cx;
    const dy = wy - bounds.cy;
    const cos = Math.cos(-bounds.rotation);
    const sin = Math.sin(-bounds.rotation);
    return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
  }

  _handlePositions(bounds) {
    const ROTATE_OFFSET = 40;
    return {
      resize: this._localToWorld(bounds, bounds.halfW, bounds.halfH),
      rotate: this._localToWorld(bounds, 0, -bounds.halfH - ROTATE_OFFSET),
      delete: this._localToWorld(bounds, -bounds.halfW, -bounds.halfH)
    };
  }

  _deleteSelected() {
    if (!this.selectedObject) return;
    const { kind, obj } = this.selectedObject;
    if (kind === 'stamp') this.stamps = this.stamps.filter(s => s !== obj);
    else this.texts = this.texts.filter(t => t !== obj);
    this.selectedObject = null;
    this.render();
  }

  _drawSelectionHandles(selection) {
    const { ctx } = this;
    const bounds = this._getObjBounds(selection);
    const corners = [
      this._localToWorld(bounds, -bounds.halfW, -bounds.halfH),
      this._localToWorld(bounds, bounds.halfW, -bounds.halfH),
      this._localToWorld(bounds, bounds.halfW, bounds.halfH),
      this._localToWorld(bounds, -bounds.halfW, bounds.halfH)
    ];
    const handles = this._handlePositions(bounds);

    ctx.save();
    ctx.strokeStyle = 'rgba(255, 95, 162, 0.9)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);

    // 回転ハンドルへのガイド線
    const topMid = this._localToWorld(bounds, 0, -bounds.halfH);
    ctx.beginPath();
    ctx.moveTo(topMid.x, topMid.y);
    ctx.lineTo(handles.rotate.x, handles.rotate.y);
    ctx.stroke();

    const HANDLE_R = 24;
    const drawHandle = (pos, emoji, bg) => {
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, HANDLE_R, 0, Math.PI * 2);
      ctx.fillStyle = bg || '#ffffff';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = 'rgba(255, 95, 162, 0.9)';
      ctx.stroke();
      ctx.font = `${Math.round(HANDLE_R * 1.15)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const m = ctx.measureText(emoji);
      const vOffset = ((m.actualBoundingBoxAscent || 0) - (m.actualBoundingBoxDescent || 0)) / 2;
      ctx.fillText(emoji, pos.x, pos.y + vOffset);
    };
    drawHandle(handles.resize, '↔️');
    drawHandle(handles.rotate, '🔄');
    drawHandle(handles.delete, '🗑️', 'rgba(255,255,255,0.95)');
    ctx.restore();
  }

  _hitTestHandle(selection, x, y) {
    const bounds = this._getObjBounds(selection);
    const handles = this._handlePositions(bounds);
    const RADIUS = 28;
    if (Math.hypot(x - handles.delete.x, y - handles.delete.y) <= RADIUS) {
      return { mode: 'delete', bounds };
    }
    if (Math.hypot(x - handles.resize.x, y - handles.resize.y) <= RADIUS) {
      return { mode: 'resize', bounds };
    }
    if (Math.hypot(x - handles.rotate.x, y - handles.rotate.y) <= RADIUS) {
      return { mode: 'rotate', bounds };
    }
    return null;
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
      const bounds = this._getObjBounds({ kind: 'stamp', obj: s });
      const local = this._worldToLocal(bounds, x, y);
      if (Math.abs(local.x) <= bounds.halfW && Math.abs(local.y) <= bounds.halfH) return s;
    }
    return null;
  }

  _hitTestText(x, y) {
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      const bounds = this._getObjBounds({ kind: 'text', obj: t });
      const local = this._worldToLocal(bounds, x, y);
      if (Math.abs(local.x) <= bounds.halfW && Math.abs(local.y) <= bounds.halfH) return t;
    }
    return null;
  }

  _onPointerDown(e) {
    if (!this.baseImage) return;
    const { x, y } = this._toCanvasCoords(e);

    // 描画中・ドラッグ中・拡大縮小/回転中は、別の指の操作を無視する
    // （フレーム位置調整のピンチズームだけは2本指の操作を前提とするため例外）
    if (!this.frameAdjustMode && (this._isDrawing || this._dragTarget || this._handleMode)) {
      return;
    }

    if (this.activeTab === 'draw') {
      this._isDrawing = true;
      this._pushUndo();
      this._strokeSnapshot = this.drawCtx.getImageData(0, 0, this.drawLayer.width, this.drawLayer.height);
      this._strokePoints = [{ x, y }];
      this._redrawStroke();
      return;
    }

    // 位置調整モード：ドラッグで窓枠内の写真位置を調整（2本指でピンチするとズーム）
    if (this.frameAdjustMode && this.frame) {
      this._activePointers.set(e.pointerId, { x, y });
      this.canvas.setPointerCapture(e.pointerId);
      if (this._activePointers.size >= 2) {
        this._isPanningPhoto = false;
        const pts = [...this._activePointers.values()].slice(0, 2);
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        this._pinchStart = { dist, scale: this.framePhotoTransform.scale };
      } else {
        this._isPanningPhoto = true;
        this._panStart = {
          x, y,
          offsetX: this.framePhotoTransform.offsetX,
          offsetY: this.framePhotoTransform.offsetY
        };
      }
      return;
    }

    // 選択中の配置物：リサイズ・回転ハンドルの操作判定
    if (this.selectedObject) {
      const handleHit = this._hitTestHandle(this.selectedObject, x, y);
      if (handleHit) {
        if (handleHit.mode === 'delete') {
          this._deleteSelected();
          return;
        }
        const { kind, obj } = this.selectedObject;
        this._handleMode = handleHit.mode;
        if (handleHit.mode === 'resize') {
          const dist = Math.hypot(x - handleHit.bounds.cx, y - handleHit.bounds.cy);
          this._handleStart = {
            dist,
            size: kind === 'stamp' ? obj.size : obj.size,
            cx: handleHit.bounds.cx,
            cy: handleHit.bounds.cy
          };
        } else {
          const angle = Math.atan2(y - handleHit.bounds.cy, x - handleHit.bounds.cx);
          this._handleStart = {
            angle,
            rotation: obj.rotation || 0,
            cx: handleHit.bounds.cx,
            cy: handleHit.bounds.cy
          };
        }
        this.canvas.setPointerCapture(e.pointerId);
        return;
      }
    }

    // スタンプ / テキストのドラッグ・選択判定（追加した上のレイヤーから優先）
    const text = this._hitTestText(x, y);
    if (text) {
      this.selectedObject = { kind: 'text', obj: text };
      this._dragTarget = { kind: 'text', obj: text };
      this._dragOffset = { x: x - text.x, y: y - text.y };
      this.canvas.setPointerCapture(e.pointerId);
      this.render();
      return;
    }
    const stamp = this._hitTestStamp(x, y);
    if (stamp) {
      this.selectedObject = { kind: 'stamp', obj: stamp };
      this._dragTarget = { kind: 'stamp', obj: stamp };
      this._dragOffset = { x: x - stamp.x, y: y - stamp.y };
      this.canvas.setPointerCapture(e.pointerId);
      this.render();
      return;
    }

    // 何もないところをタップしたら選択解除
    if (this.selectedObject) {
      this.selectedObject = null;
      this.render();
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

    if (this.frameAdjustMode && this._activePointers.has(e.pointerId)) {
      this._activePointers.set(e.pointerId, { x, y });
      if (this._pinchStart && this._activePointers.size >= 2) {
        const pts = [...this._activePointers.values()].slice(0, 2);
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        const ratio = dist / this._pinchStart.dist;
        const newScale = Math.min(2.5, Math.max(0.5, this._pinchStart.scale * ratio));
        this.setFramePhotoScale(newScale);
        return;
      }
      if (this._isPanningPhoto) {
        this.framePhotoTransform.offsetX = this._panStart.offsetX + (x - this._panStart.x);
        this.framePhotoTransform.offsetY = this._panStart.offsetY + (y - this._panStart.y);
        this.render();
      }
      return;
    }

    if (this._handleMode && this.selectedObject) {
      const { kind, obj } = this.selectedObject;
      if (this._handleMode === 'resize') {
        const dist = Math.hypot(x - this._handleStart.cx, y - this._handleStart.cy);
        const ratio = dist / Math.max(1, this._handleStart.dist);
        const newSize = Math.min(800, Math.max(20, Math.round(this._handleStart.size * ratio)));
        if (kind === 'stamp') {
          const cx = obj.x + obj.size / 2;
          const cy = obj.y + obj.size / 2;
          obj.size = newSize;
          obj.x = cx - newSize / 2;
          obj.y = cy - newSize / 2;
        } else {
          obj.size = newSize;
        }
      } else {
        const angle = Math.atan2(y - this._handleStart.cy, x - this._handleStart.cx);
        obj.rotation = this._handleStart.rotation + (angle - this._handleStart.angle);
      }
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

  _onPointerUp(e) {
    this._isDrawing = false;
    this._strokeSnapshot = null;
    this._strokePoints = null;
    this._isPanningPhoto = false;
    this._panStart = null;
    this._pinchStart = null;
    if (e && this._activePointers.has(e.pointerId)) {
      this._activePointers.delete(e.pointerId);
    }
    this._dragTarget = null;
    this._handleMode = null;
    this._handleStart = null;
  }

  _onDoubleClick(e) {
    if (!this.baseImage || this.activeTab === 'draw') return;
    const { x, y } = this._toCanvasCoords(e);

    const text = this._hitTestText(x, y);
    if (text) {
      this.texts = this.texts.filter(t => t !== text);
      if (this.selectedObject && this.selectedObject.obj === text) this.selectedObject = null;
      this.render();
      return;
    }
    const stamp = this._hitTestStamp(x, y);
    if (stamp) {
      this.stamps = this.stamps.filter(s => s !== stamp);
      if (this.selectedObject && this.selectedObject.obj === stamp) this.selectedObject = null;
      this.render();
    }
  }

  // ---- 手書き描画 ----
  _pushUndo() {
    const { width, height } = this.drawLayer;
    if (!width || !height) return;
    this.undoStack.push(this.drawCtx.getImageData(0, 0, width, height));
    if (this.undoStack.length > 20) this.undoStack.shift();
    this.redoStack = [];
    this._notifyUndoStackChange();
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
