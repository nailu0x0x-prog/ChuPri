// アプリ全体の制御（画面遷移・取込・各タブのUI連携）

// プリ風フレーム一覧。rect は窓枠（写真を配置する白い部分）の位置・サイズを
// フレーム画像に対する相対値（0〜1）で指定する。
const FRAME_ASSETS = [
  { file: 'chupri-pink.png',   name: 'ChuPri ピンク',   rect: { x: 0.117, y: 0.219, w: 0.765, h: 0.672 } },
  { file: 'chupri-purple.png', name: 'ChuPri むらさき', rect: { x: 0.117, y: 0.219, w: 0.765, h: 0.672 } }
];

// 用意する画像アセットのファイル名一覧。
// assets/stamps に同名の画像（PNG推奨・透過背景）を置くと一覧に表示される。
// 見つからないファイルは自動的にスキップされる。
const STAMP_ASSETS = [
  { file: 'heart.png',     name: 'ハート' },
  { file: 'star.png',      name: 'スター' },
  { file: 'mic.png',       name: 'マイク' },
  { file: 'note.png',      name: '音符' },
  { file: 'headset.png',   name: '配信アイコン' },
  { file: 'controller.png',name: 'コントローラー' },
  { file: 'emote-smile.png', name: 'にこにこ' },
  { file: 'emote-cry.png',   name: 'えーん' },
  { file: 'chupri-blob-star.png',  name: 'ぷにぷにスター' },
  { file: 'chupri-feather.png',    name: 'はね' },
  { file: 'chupri-sparkle.png',    name: 'キラキラ' },
  { file: 'chupri-dot-heart.png',  name: 'ドットハート' },
  { file: 'chupri-ribbon.png',     name: 'リボン' },
  { file: 'chupri-bubble-excl.png',name: '吹き出し！！' }
];

const $ = (sel) => document.querySelector(sel);

const screens = {
  frame: $('#screen-frame'),
  import: $('#screen-import'),
  edit: $('#screen-edit'),
  save: $('#screen-save')
};

function showScreen(name) {
  Object.entries(screens).forEach(([key, el]) => {
    el.classList.toggle('active', key === name);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// ---- メイン編集画面のセットアップ ----
const canvas = $('#main-canvas');
const editor = new CanvasEditor(canvas);

let cameraStream = null;
let selectedFrame = null; // { image, rect } | null（フレーム選択画面で選んだもの）

// ---- ① フレーム選択（スワイプで切り替えるカルーセル）----
const frameCarousel = $('#frame-carousel');
const frameDots = $('#frame-dots');
let frameSelectBuilt = false;
let frameCards = []; // { el, dot, value: { image, rect } | null }

function selectFrameCardByIndex(index) {
  frameCards.forEach((card, i) => {
    card.el.classList.toggle('selected', i === index);
    card.dot.classList.toggle('active', i === index);
  });
  selectedFrame = frameCards[index] ? frameCards[index].value : null;
}

function setupFrameSelectScreen() {
  if (frameSelectBuilt) return;
  frameSelectBuilt = true;

  const addCard = (value, { name, previewEl }) => {
    const index = frameCards.length;
    const card = document.createElement('div');
    card.className = 'frame-card';

    const preview = document.createElement('div');
    preview.className = 'frame-card-preview';
    if (previewEl) {
      preview.appendChild(previewEl);
    } else {
      preview.classList.add('is-none');
      preview.textContent = 'フレームなし';
    }
    card.appendChild(preview);

    const label = document.createElement('div');
    label.className = 'frame-card-name';
    label.textContent = name;
    card.appendChild(label);

    const dot = document.createElement('span');
    dot.className = 'frame-dot';
    dot.addEventListener('click', () => {
      frameCarousel.scrollTo({ left: card.offsetLeft, behavior: 'smooth' });
    });
    frameDots.appendChild(dot);

    frameCarousel.appendChild(card);
    frameCards.push({ el: card, dot, value });
    return index;
  };

  // 「フレームなし」
  addCard(null, { name: 'フレームなし', previewEl: null });

  // フレーム画像は順序を保つため、すべて読み込んでからカードを追加する
  Promise.all(FRAME_ASSETS.map(({ file, name, rect }) =>
    loadImage(`assets/frames/${file}`)
      .then((img) => ({ img, name, rect }))
      .catch(() => {
        console.warn(`フレーム画像が見つかりません: assets/frames/${file}`);
        return null;
      })
  )).then((results) => {
    results.filter(Boolean).forEach(({ img, name, rect }) => {
      const thumb = document.createElement('img');
      thumb.src = img.src;
      thumb.alt = name;
      addCard({ image: img, rect }, { name, previewEl: thumb });
    });
    selectFrameCardByIndex(0);
  });

  selectFrameCardByIndex(0);

  // スワイプ位置から選択中のカードを判定
  let scrollTimer = null;
  frameCarousel.addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      const center = frameCarousel.scrollLeft + frameCarousel.clientWidth / 2;
      let closestIndex = 0;
      let closestDist = Infinity;
      frameCards.forEach((card, i) => {
        const cardCenter = card.el.offsetLeft + card.el.offsetWidth / 2;
        const dist = Math.abs(cardCenter - center);
        if (dist < closestDist) {
          closestDist = dist;
          closestIndex = i;
        }
      });
      selectFrameCardByIndex(closestIndex);
    }, 80);
  });
}
setupFrameSelectScreen();

$('#btn-frame-next').addEventListener('click', () => {
  showScreen('import');
});

// ---- ② 画像取込 ----
function openEditorWithImage(image) {
  editor.setImage(image);
  editor.setFrame(selectedFrame ? selectedFrame.image : null, selectedFrame ? selectedFrame.rect : null);
  $('#bg-color').value = editor.bgColor;
  showScreen('edit');
  setupFilterTab();

  // フレームが選ばれていれば「写真の位置調整」ボタンを表示し、調整モードを案内
  const adjustBtn = $('#btn-frame-adjust');
  if (selectedFrame) {
    adjustBtn.classList.remove('hidden');
    framePhotoScale.value = 1;
  } else {
    adjustBtn.classList.add('hidden');
  }
  frameAdjustPanel.classList.add('hidden');
  adjustBtn.classList.remove('active');
  editor.setFrameAdjustMode(false);
}

$('#bg-color').addEventListener('input', (e) => editor.setBgColor(e.target.value));

function handleFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    loadImage(e.target.result).then(openEditorWithImage);
  };
  reader.readAsDataURL(file);
}

$('#file-input').addEventListener('change', (e) => {
  handleFile(e.target.files[0]);
  e.target.value = '';
});

const dropzone = $('#dropzone');
['dragenter', 'dragover'].forEach(evt =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add('drag-over');
  })
);
['dragleave', 'drop'].forEach(evt =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
  })
);
dropzone.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  handleFile(file);
});

// カメラ撮影
const cameraView = $('#camera-view');
const cameraVideo = $('#camera-video');

$('#btn-camera').addEventListener('click', async () => {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
    cameraVideo.srcObject = cameraStream;
    cameraView.classList.remove('hidden');
  } catch (err) {
    alert('カメラを起動できませんでした: ' + err.message);
  }
});

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
  cameraView.classList.add('hidden');
}

$('#btn-camera-cancel').addEventListener('click', stopCamera);

$('#btn-shoot').addEventListener('click', () => {
  const tmp = document.createElement('canvas');
  tmp.width = cameraVideo.videoWidth;
  tmp.height = cameraVideo.videoHeight;
  tmp.getContext('2d').drawImage(cameraVideo, 0, 0);
  loadImage(tmp.toDataURL('image/png')).then((img) => {
    stopCamera();
    openEditorWithImage(img);
  });
});

// ---- ② 編集画面 ----

// タブ切り替え
const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tool-panel');

tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    tabButtons.forEach(b => b.classList.toggle('active', b === btn));
    tabPanels.forEach(p => p.classList.toggle('active', p.dataset.panel === tab));
    editor.setActiveTab(tab);
  });
});

// --- スタンプ ---
const stampList = $('#stamp-list');
let stampsLoaded = false;
function setupStampTab() {
  if (stampsLoaded) return;
  stampsLoaded = true;

  STAMP_ASSETS.forEach(({ file, name }) => {
    loadImage(`assets/stamps/${file}`).then((img) => {
      const item = document.createElement('div');
      item.className = 'thumb-item';
      item.title = name;
      const thumb = document.createElement('img');
      thumb.src = img.src;
      thumb.alt = name;
      item.appendChild(thumb);
      item.addEventListener('click', () => editor.addStamp(img));
      stampList.appendChild(item);
    }).catch(() => {
      console.warn(`スタンプ画像が見つかりません: assets/stamps/${file}`);
    });
  });
}

// --- フレーム内の写真位置調整（編集画面のキャンバス上部のトグルボタン）---
const frameAdjustBtn = $('#btn-frame-adjust');
const frameAdjustPanel = $('#frame-adjust-panel');
const framePhotoScale = $('#frame-photo-scale');

frameAdjustBtn.addEventListener('click', () => {
  const on = !frameAdjustBtn.classList.contains('active');
  frameAdjustBtn.classList.toggle('active', on);
  frameAdjustPanel.classList.toggle('hidden', !on);
  editor.setFrameAdjustMode(on);
});

framePhotoScale.addEventListener('input', (e) => {
  editor.setFramePhotoScale(Number(e.target.value), { silent: true });
});

// ピンチ操作でスケールが変わったらスライダー側の表示も合わせる
editor.onFrameScaleChange = (scale) => {
  framePhotoScale.value = scale;
};

// --- 落書き ---
$('#pen-color').addEventListener('input', (e) => editor.setPenColor(e.target.value));
$('#pen-width').addEventListener('input', (e) => {
  editor.setPenWidth(Number(e.target.value));
  $('#pen-width-value').textContent = e.target.value;
});

const btnPen = $('#btn-pen');
const btnEraser = $('#btn-eraser');
btnPen.addEventListener('click', () => {
  editor.setTool('pen');
  btnPen.classList.add('active');
  btnEraser.classList.remove('active');
});
btnEraser.addEventListener('click', () => {
  editor.setTool('eraser');
  btnEraser.classList.add('active');
  btnPen.classList.remove('active');
});
// ペンの種類：文字だけだと見た目が分からないので「〜」のプレビューをアイコンとして並べる（3列×3行）
const PEN_STYLES = [
  { key: 'normal',           label: 'ノーマル' },
  { key: 'outline',          label: '縁取り' },
  { key: 'puffy',            label: 'ぷっくり' },
  { key: 'translucent',      label: '半透明' },
  { key: 'double',           label: '二重' },
  { key: 'marker',           label: 'マーカー' },
  { key: 'neon',             label: 'ネオンペン' },
  { key: 'fluffy',           label: 'ふわふわ' },
  { key: 'blackOutlineShift',label: '黒縁ずれ' }
];

function drawPenStyleIcon(canvas, styleKey) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const points = [];
  const segments = 24;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    points.push({
      x: 6 + t * (w - 12),
      y: h / 2 + Math.sin(t * Math.PI * 2.4) * (h * 0.22)
    });
  }
  CanvasEditor.paintStrokePath(ctx, points, { width: 4, color: '#ff5fa2', style: styleKey });
}

const penStyleGrid = $('#pen-style-grid');
const penStyleButtons = [];
PEN_STYLES.forEach(({ key, label }) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn pen-style-btn';
  btn.dataset.style = key;
  if (key === 'normal') btn.classList.add('active');

  const icon = document.createElement('canvas');
  icon.className = 'pen-style-icon';
  icon.width = 64;
  icon.height = 32;
  btn.appendChild(icon);

  const text = document.createElement('span');
  text.className = 'pen-style-label';
  text.textContent = label;
  btn.appendChild(text);

  drawPenStyleIcon(icon, key);

  btn.addEventListener('click', () => {
    penStyleButtons.forEach(b => b.classList.toggle('active', b === btn));
    editor.setPenStyle(key);
  });

  penStyleGrid.appendChild(btn);
  penStyleButtons.push(btn);
});

const btnUndo = $('#btn-undo');
const btnRedo = $('#btn-redo');
const btnClearDraw = $('#btn-clear-draw');
btnUndo.addEventListener('click', () => editor.undo());
btnRedo.addEventListener('click', () => editor.redo());
btnClearDraw.addEventListener('click', () => editor.clearDrawing());

// 戻す/やり直す/全て戻るボタンの有効・無効をスタックの状態に合わせて切り替える
editor.onUndoStackChange = (undoCount, redoCount) => {
  btnUndo.disabled = undoCount === 0;
  btnRedo.disabled = redoCount === 0;
  btnClearDraw.disabled = undoCount === 0;
};
editor.onUndoStackChange(editor.undoStack.length, editor.redoStack.length);

// 消しゴムサイズのドット選択
const eraserDots = document.querySelectorAll('.eraser-dot');
eraserDots.forEach(dot => {
  dot.addEventListener('click', () => {
    const size = Number(dot.dataset.size);
    eraserDots.forEach(d => d.classList.toggle('active', d === dot));
    editor.setTool('eraser');
    editor.setPenWidth(size);
    btnEraser.classList.add('active');
    btnPen.classList.remove('active');
    $('#pen-width').value = size;
    $('#pen-width-value').textContent = size;
  });
});

// --- 文字入れ ---
$('#btn-add-text').addEventListener('click', () => {
  const text = $('#text-input').value.trim();
  if (!text) return;
  editor.addText({
    text,
    font: $('#text-font').value,
    size: Number($('#text-size').value),
    color: $('#text-color').value,
    stroke: $('#text-stroke').value,
    shadow: $('#text-shadow').checked
  });
  $('#text-input').value = '';
});

// --- フィルター ---
const filterList = $('#filter-list');
let filtersBuilt = false;
function setupFilterTab() {
  if (filtersBuilt) return;
  filtersBuilt = true;
  renderFilterThumbnails(filterList, editor.canvas, (filter) => editor.setFilter(filter));
}

// 初回タブ表示時にスタンプ一覧を遅延ロード
document.querySelector('.tab-btn[data-tab="stamp"]').addEventListener('click', setupStampTab, { once: true });

// 戻る
$('#btn-back').addEventListener('click', () => {
  if (confirm('取込画面に戻りますか？編集内容は失われます。')) {
    showScreen('import');
  }
});

// ---- ③ 保存・シェア ----
$('#btn-goto-save').addEventListener('click', () => {
  const dataUrl = editor.toDataURL();
  $('#result-image').src = dataUrl;
  $('#btn-download').href = dataUrl;
  $('#copy-msg').textContent = '';
  showScreen('save');
});

$('#btn-back-edit').addEventListener('click', () => showScreen('edit'));

$('#btn-copy').addEventListener('click', async () => {
  try {
    const blob = await (await fetch($('#result-image').src)).blob();
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    $('#copy-msg').textContent = 'クリップボードにコピーしました！';
  } catch (err) {
    $('#copy-msg').textContent = 'コピーに失敗しました（ブラウザが対応していない可能性があります）';
  }
});

$('#btn-restart').addEventListener('click', () => {
  showScreen('import');
});
