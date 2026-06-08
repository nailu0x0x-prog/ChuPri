// フィルタープリセット定義
// 各プリセットは draw(ctx, srcCanvas, w, h) を持ち、
// srcCanvas の内容を ctx に加工して描画する。

// 4本線の小さな星をひとつ描く（キラキラ系フィルターで使用）
function drawSparkleStar(ctx, x, y, r, alpha) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
  ctx.lineWidth = Math.max(0.6, r * 0.25);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-r, 0); ctx.lineTo(r, 0);
  ctx.moveTo(0, -r); ctx.lineTo(0, r);
  ctx.stroke();
  ctx.restore();
}

const FILTERS = [
  {
    id: 'normal',
    name: 'ノーマル',
    draw(ctx, src, w, h) {
      ctx.filter = 'none';
      ctx.drawImage(src, 0, 0, w, h);
    }
  },
  {
    id: 'pastel',
    name: 'ふわふわパステル',
    // 全体を淡くふんわりと、彩度を落として優しい印象に
    draw(ctx, src, w, h) {
      ctx.filter = 'brightness(1.12) saturate(0.6) contrast(0.9)';
      ctx.drawImage(src, 0, 0, w, h);
      ctx.filter = 'none';
      ctx.fillStyle = 'rgba(255, 235, 245, 0.16)';
      ctx.fillRect(0, 0, w, h);
    }
  },
  {
    id: 'ichigo-milk',
    name: 'いちごみるく',
    // 斜めのピンク×ミルク色グラデーションで甘い質感を強調
    draw(ctx, src, w, h) {
      ctx.filter = 'brightness(1.1) saturate(1.15) contrast(0.95)';
      ctx.drawImage(src, 0, 0, w, h);
      ctx.filter = 'none';
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, 'rgba(255, 110, 170, 0.28)');
      grad.addColorStop(0.55, 'rgba(255, 200, 220, 0.12)');
      grad.addColorStop(1, 'rgba(255, 250, 240, 0.22)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }
  },
  {
    id: 'yumekawa',
    name: 'ゆめかわラベンダー',
    // 紫〜青寄りの色味と外周の光でドリーミーな雰囲気に
    draw(ctx, src, w, h) {
      ctx.filter = 'brightness(1.05) saturate(1.05) contrast(0.92) hue-rotate(-12deg)';
      ctx.drawImage(src, 0, 0, w, h);
      ctx.filter = 'none';
      ctx.fillStyle = 'rgba(180, 160, 255, 0.18)';
      ctx.fillRect(0, 0, w, h);
      const glow = ctx.createRadialGradient(w/2, h/2, Math.min(w,h)*0.15, w/2, h/2, Math.max(w,h)*0.75);
      glow.addColorStop(0, 'rgba(255, 255, 255, 0)');
      glow.addColorStop(1, 'rgba(120, 90, 200, 0.35)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
    }
  },
  {
    id: 'sparkle',
    name: 'キラキラスター',
    // 中心からのグロー＋十字スターを散りばめて華やかに
    draw(ctx, src, w, h) {
      ctx.filter = 'brightness(1.15) saturate(1.05) contrast(0.95)';
      ctx.drawImage(src, 0, 0, w, h);
      ctx.filter = 'none';

      const glow = ctx.createRadialGradient(w/2, h*0.38, 0, w/2, h*0.38, Math.max(w, h) * 0.75);
      glow.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
      glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);

      const starCount = Math.max(8, Math.round((w * h) / 14000));
      for (let i = 0; i < starCount; i++) {
        const x = Math.random() * w;
        const y = Math.random() * h;
        const r = Math.random() * 3 + 1.5;
        drawSparkleStar(ctx, x, y, r, 0.4 + Math.random() * 0.45);
      }
    }
  },
  {
    id: 'melon-soda',
    name: 'メロンソーダ',
    // ミント〜水色の斜めグラデーションで爽やかな夢かわ系に
    draw(ctx, src, w, h) {
      ctx.filter = 'brightness(1.1) saturate(1.1) contrast(0.94)';
      ctx.drawImage(src, 0, 0, w, h);
      ctx.filter = 'none';
      const grad = ctx.createLinearGradient(0, h, w, 0);
      grad.addColorStop(0, 'rgba(140, 235, 210, 0.26)');
      grad.addColorStop(0.55, 'rgba(210, 250, 255, 0.12)');
      grad.addColorStop(1, 'rgba(180, 220, 255, 0.2)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }
  }
];

// フィルター選択タブ用のサムネイルを生成して描画する
function renderFilterThumbnails(listEl, sourceCanvas, onSelect) {
  listEl.innerHTML = '';
  const thumbW = 90;
  const thumbH = Math.round(thumbW * (sourceCanvas.height / sourceCanvas.width)) || thumbW;

  FILTERS.forEach((filter, index) => {
    const item = document.createElement('div');
    item.className = 'filter-item';
    if (index === 0) item.classList.add('selected');

    const canvas = document.createElement('canvas');
    canvas.width = thumbW;
    canvas.height = thumbH;
    const ctx = canvas.getContext('2d');
    filter.draw(ctx, sourceCanvas, thumbW, thumbH);

    const label = document.createElement('span');
    label.textContent = filter.name;

    item.appendChild(canvas);
    item.appendChild(label);
    item.addEventListener('click', () => {
      listEl.querySelectorAll('.filter-item').forEach(el => el.classList.remove('selected'));
      item.classList.add('selected');
      onSelect(filter);
    });
    listEl.appendChild(item);
  });
}
