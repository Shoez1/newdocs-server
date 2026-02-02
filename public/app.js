function formatBytes(bytes) {
  if (bytes == null || Number.isNaN(bytes)) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u += 1;
  }
  return `${v.toFixed(v >= 10 || u === 0 ? 0 : 1)} ${units[u]}`;
}

function formatDateTime(ms) {
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return '';
  }
}

function setVisible(el, visible) {
  if (!el) return;
  el.classList.toggle('hidden', !visible);
}

const pageUpload = document.getElementById('page-upload');
const pageTransfer = document.getElementById('page-transfer');

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const btnPick = document.getElementById('btnPick');
const btnUpload = document.getElementById('btnUpload');
const selectedInfo = document.getElementById('selectedInfo');
const uploadStatus = document.getElementById('uploadStatus');
const progressBar = document.getElementById('progressBar');

const result = document.getElementById('result');
const resultLink = document.getElementById('resultLink');
const btnCopy = document.getElementById('btnCopy');
const expiresInfo = document.getElementById('expiresInfo');

const filesList = document.getElementById('filesList');
const transferMeta = document.getElementById('transferMeta');
const transferError = document.getElementById('transferError');

let selectedFiles = [];

function updateSelectedInfo() {
  if (!selectedInfo) return;
  if (!selectedFiles.length) {
    selectedInfo.textContent = '';
    btnUpload.disabled = true;
    return;
  }

  const total = selectedFiles.reduce((acc, f) => acc + (f.size || 0), 0);
  selectedInfo.textContent = `${selectedFiles.length} arquivo(s) selecionado(s) (${formatBytes(total)})`;
  btnUpload.disabled = false;
}

function setupUploadPage() {
  setVisible(pageUpload, true);
  setVisible(pageTransfer, false);

  btnPick?.addEventListener('click', () => fileInput?.click());

  fileInput?.addEventListener('change', () => {
    selectedFiles = Array.from(fileInput.files || []);
    updateSelectedInfo();
  });

  dropzone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('border-indigo-400');
  });

  dropzone?.addEventListener('dragleave', () => {
    dropzone.classList.remove('border-indigo-400');
  });

  dropzone?.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('border-indigo-400');
    const dt = e.dataTransfer;
    if (!dt) return;
    selectedFiles = Array.from(dt.files || []);
    if (fileInput) fileInput.files = dt.files;
    updateSelectedInfo();
  });

  btnUpload?.addEventListener('click', () => {
    if (!selectedFiles.length) return;

    setVisible(result, false);
    uploadStatus.textContent = 'Enviando...';
    progressBar.style.width = '0%';
    btnUpload.disabled = true;

    const form = new FormData();
    for (const f of selectedFiles) form.append('files', f, f.name);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/uploads');

    xhr.upload.addEventListener('progress', (e) => {
      if (!e.lengthComputable) return;
      const pct = Math.round((e.loaded / e.total) * 100);
      progressBar.style.width = `${pct}%`;
    });

    xhr.addEventListener('load', () => {
      btnUpload.disabled = false;

      if (xhr.status < 200 || xhr.status >= 300) {
        uploadStatus.textContent = 'Falha no envio.';
        return;
      }

      try {
        const data = JSON.parse(xhr.responseText);
        uploadStatus.textContent = 'Concluído.';
        setVisible(result, true);
        resultLink.value = data.url;
        expiresInfo.textContent = data.expiresAt ? `Expira em: ${formatDateTime(data.expiresAt)}` : '';
      } catch {
        uploadStatus.textContent = 'Concluído, mas não consegui ler a resposta.';
      }
    });

    xhr.addEventListener('error', () => {
      btnUpload.disabled = false;
      uploadStatus.textContent = 'Erro de rede durante o envio.';
    });

    xhr.send(form);
  });

  btnCopy?.addEventListener('click', async () => {
    const text = resultLink?.value;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      btnCopy.textContent = 'Copiado';
      setTimeout(() => (btnCopy.textContent = 'Copiar'), 1200);
    } catch {
      resultLink.select();
      document.execCommand('copy');
    }
  });
}

async function setupTransferPage(id) {
  setVisible(pageUpload, false);
  setVisible(pageTransfer, true);
  setVisible(transferError, false);

  filesList.innerHTML = '';
  transferMeta.textContent = 'Carregando...';

  try {
    const res = await fetch(`/api/transfers/${encodeURIComponent(id)}`);
    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      const msg = payload?.error || 'Link inválido ou expirado.';
      transferMeta.textContent = '';
      transferError.textContent = msg;
      setVisible(transferError, true);
      return;
    }

    const data = await res.json();
    transferMeta.textContent = data.expiresAt ? `Expira em: ${formatDateTime(data.expiresAt)}` : '';

    for (const f of data.files || []) {
      const row = document.createElement('div');
      row.className = 'flex items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-950/30 p-4';

      const left = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'font-medium text-slate-100';
      name.textContent = f.name;

      const meta = document.createElement('div');
      meta.className = 'text-xs text-slate-400';
      meta.textContent = f.size != null ? formatBytes(f.size) : '';

      left.appendChild(name);
      left.appendChild(meta);

      const a = document.createElement('a');
      a.href = f.downloadUrl;
      a.className = 'inline-flex items-center justify-center rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400';
      a.textContent = 'Baixar';

      row.appendChild(left);
      row.appendChild(a);

      filesList.appendChild(row);
    }
  } catch {
    transferMeta.textContent = '';
    transferError.textContent = 'Erro ao carregar o link.';
    setVisible(transferError, true);
  }
}

(function init() {
  const path = window.location.pathname || '/';
  const m = path.match(/^\/t\/([^/]+)$/);

  if (m) {
    setupTransferPage(m[1]);
  } else {
    setupUploadPage();
  }
})();
