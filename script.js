// ── STATE ──
let selectedFile = null;
let compressedBase64 = null;
let compressedMime = null;
let previewDataUrl = null;
let selectedLang = 'EN';

// ── DOM ──
const dropZone    = document.getElementById('drop-zone');
const fileInput   = document.getElementById('file-input');
const browseBtn   = document.getElementById('browse-btn');
const changeBtn   = document.getElementById('change-btn');
const uploadPrompt = document.getElementById('upload-prompt');
const previewWrap = document.getElementById('preview-wrap');
const previewImg  = document.getElementById('preview-img');
const previewFilename = document.getElementById('preview-filename');
const detectBtn   = document.getElementById('detect-btn');
const backBtn     = document.getElementById('back-btn');


// ── SECTION NAVIGATION ──
function showSection(id) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo({ top: 0, behavior: 'instant' });
}

// ── FILE HANDLING ──
browseBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  fileInput.click();
});

changeBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  resetUpload();
  fileInput.click();
});

dropZone.addEventListener('click', () => {
  if (!selectedFile) fileInput.click();
});

fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) handleFile(fileInput.files[0]);
});

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', (e) => {
  if (!dropZone.contains(e.relatedTarget)) {
    dropZone.classList.remove('drag-over');
  }
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) handleFile(file);
});

function handleFile(file) {
  if (!file.type.startsWith('image/')) return;

  selectedFile = file;
  compressImage(file, (base64, mime, dataUrl) => {
    compressedBase64 = base64;
    compressedMime   = mime;
    previewDataUrl   = dataUrl;

    previewImg.src = dataUrl;
    previewFilename.textContent = file.name;

    uploadPrompt.style.display = 'none';
    previewWrap.style.display  = 'flex';
    dropZone.classList.add('has-file');
    detectBtn.disabled = false;
  });
}

function resetUpload() {
  selectedFile    = null;
  compressedBase64 = null;
  fileInput.value  = '';

  uploadPrompt.style.display = 'flex';
  previewWrap.style.display  = 'none';
  dropZone.classList.remove('has-file');
  detectBtn.disabled = true;
}

function resetAll() {
  resetUpload();
  showSection('upload-section');
}

backBtn.addEventListener('click', resetAll);

// ── LANGUAGE SELECTOR ──
const langSelector = document.getElementById('lang-selector');
const langBtn      = document.getElementById('lang-btn');
const langFlag     = document.getElementById('lang-flag');
const langCode     = document.getElementById('lang-code');

langBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  langSelector.classList.toggle('open');
});

document.addEventListener('click', () => {
  langSelector.classList.remove('open');
});

document.querySelectorAll('.lang-option').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    selectedLang         = btn.dataset.lang;
    langFlag.textContent = btn.dataset.flag;
    langCode.textContent = btn.dataset.lang;
    document.querySelectorAll('.lang-option').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    langSelector.classList.remove('open');
  });
});

// ── IMAGE COMPRESSION ──
function compressImage(file, callback) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 1024;
      let { width, height } = img;

      if (width > height && width > MAX) {
        height = Math.round((height * MAX) / width);
        width  = MAX;
      } else if (height > MAX) {
        width  = Math.round((width * MAX) / height);
        height = MAX;
      }

      const canvas = document.createElement('canvas');
      canvas.width  = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);

      const mime   = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
      const dataUrl = canvas.toDataURL(mime, 0.85);
      const base64  = dataUrl.split(',')[1];

      callback(base64, mime, dataUrl);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// ── DETECT ──
detectBtn.addEventListener('click', async () => {
  if (!compressedBase64) return;

  showSection('loading-section');

  try {
    const res = await fetch('/api/detect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: compressedBase64, mimeType: compressedMime, language: selectedLang }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Analysis failed');
    }

    const result = await res.json();

    // Populate result page
    document.getElementById('result-img').src = previewDataUrl;
    renderResult(result);
    showSection('result-section');

  } catch (err) {
    showSection('upload-section');
    alert('Something went wrong: ' + err.message + '\nPlease try again.');
  }
});

// ── RENDER RESULT ──
function renderResult({ score, label, description, highlights }) {
  // Reset ring before animating
  const ring = document.getElementById('ring-fill');
  ring.style.strokeDashoffset = '502.655';

  const numEl   = document.getElementById('score-num');
  const labelEl = document.getElementById('result-label');
  const descEl  = document.getElementById('result-desc');
  const tagsEl  = document.getElementById('result-tags');

  numEl.textContent   = '0';
  labelEl.textContent = label || '';
  descEl.textContent  = description || '';

  // Tags
  tagsEl.innerHTML = '';
  if (Array.isArray(highlights)) {
    highlights.forEach(h => {
      const span = document.createElement('span');
      span.className   = 'result-tag';
      span.textContent = h;
      tagsEl.appendChild(span);
    });
  }

  // Animate ring & counter after a tick (so transition fires)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const circumference = 502.655;
      const offset = circumference * (1 - Math.min(Math.max(score, 0), 100) / 100);
      ring.style.strokeDashoffset = offset;
      animateCount(numEl, 0, score, 1400);
    });
  });
}

function animateCount(el, from, to, duration) {
  const start = performance.now();
  function tick(now) {
    const p = Math.min((now - start) / duration, 1);
    // ease out cubic
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(from + (to - from) * eased);
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
