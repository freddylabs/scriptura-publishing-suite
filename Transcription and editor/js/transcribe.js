/**
 * Upload, transcribe, and timestamped transcript feed
 */

const TranscribeModule = {
  init() {
    this.bindUploadEvents();
    this.bindSearchEvent();
    this.bindMediaSync();
  },

  bindUploadEvents() {
    const dropzone = document.getElementById('media-dropzone');
    const fileInput = document.getElementById('media-file-input');
    if (!dropzone || !fileInput) return;

    dropzone.addEventListener('click', () => fileInput.click());

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files.length) {
        this.handleFileUpload(e.dataTransfer.files[0]);
      }
    });

    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length) {
        this.handleFileUpload(e.target.files[0]);
      }
    });

    const runBtn = document.getElementById('btn-run-transcribe');
    if (runBtn) {
      runBtn.addEventListener('click', () => this.runTranscription());
    }
  },

  async handleFileUpload(file) {
    showToast(`Loading ${file.name}…`, 'info');

    if (AppState.mediaObjectUrl) {
      URL.revokeObjectURL(AppState.mediaObjectUrl);
    }

    const objectUrl = URL.createObjectURL(file);
    AppState.mediaObjectUrl = objectUrl;
    AppState.mediaBlobUrl = objectUrl;
    AppState.mediaIsVideo = file.type.startsWith('video') || /\.(mp4|mov|m4v|webm)$/i.test(file.name);

    const mediaContainer = document.getElementById('media-player-container');
    if (AppState.mediaIsVideo) {
      mediaContainer.innerHTML = `<video id="active-media-player" controls src="${objectUrl}"></video>`;
    } else {
      mediaContainer.innerHTML = `<audio id="active-media-player" controls src="${objectUrl}"></audio>`;
    }

    const status = document.getElementById('media-status-label');
    if (status) status.textContent = file.name.length > 22 ? `${file.name.slice(0, 20)}…` : file.name;

    this.bindMediaSync();
    HighlightsModule.attachSourceMedia(objectUrl, AppState.mediaIsVideo);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('filename', file.name);

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        AppState.mediaFile = data;
        showToast(`${file.name} is ready. Transcribe it, then open Clips to cut moments.`, 'success');
      }
    } catch (e) {
      AppState.mediaFile = { filename: file.name, localOnly: true };
      showToast('File is ready locally. Clips can still be cut in the browser.', 'info');
    }
  },

  async runTranscription() {
    const runBtn = document.getElementById('btn-run-transcribe');
    if (runBtn) {
      runBtn.disabled = true;
      runBtn.textContent = 'Transcribing…';
    }

    showToast('Transcribing with timestamps…', 'info');

    try {
      const res = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: AppState.mediaFile ? AppState.mediaFile.filePath : null
        })
      });
      const data = await res.json();
      if (data.success && data.data) {
        AppState.currentTranscript = data.data;
        this.renderTranscriptList(data.data.transcription);
        showToast('Transcript is ready. Highlight lines in Clips to cut video.', 'success');
      }
    } catch (e) {
      showToast('Using the sample transcript so you can still explore selection.', 'info');
      if (AppState.currentTranscript?.transcription) {
        this.renderTranscriptList(AppState.currentTranscript.transcription);
      }
    } finally {
      if (runBtn) {
        runBtn.disabled = false;
        runBtn.textContent = 'Transcribe with timestamps';
      }
    }
  },

  renderTranscriptList(segments) {
    const feed = document.getElementById('transcript-feed');
    const countBadge = document.getElementById('transcript-segment-count');
    if (!feed) return;

    const list = segments || [];
    if (countBadge) countBadge.textContent = `${list.length} lines`;

    feed.innerHTML = '';
    list.forEach((seg, idx) => {
      const timestamps = seg.timestamps || {};
      const fromStr = timestamps.from || '00:00:00.000';
      const toStr = timestamps.to || '00:00:00.000';
      const startSec = this.parseTimestampToSeconds(fromStr);
      const endSec = this.parseTimestampToSeconds(toStr);

      const item = document.createElement('div');
      item.className = 'transcript-item';
      item.dataset.index = String(idx);
      item.dataset.from = fromStr;
      item.dataset.seconds = String(startSec);
      item.dataset.endSeconds = String(endSec);

      item.innerHTML = `
        <div class="transcript-item-left">
          <div class="timestamp-badge">${this.shortClock(fromStr)}</div>
        </div>
        <div class="transcript-text">${this.escapeHtml(seg.text || '')}</div>
      `;

      item.addEventListener('click', () => {
        const player = document.getElementById('active-media-player') || document.getElementById('clip-source-video');
        if (player && player.src) {
          player.currentTime = startSec;
          player.play().catch(() => {});
        }
        feed.querySelectorAll('.transcript-item').forEach((el) => el.classList.remove('active'));
        item.classList.add('active');
      });

      feed.appendChild(item);
    });

    HighlightsModule.renderSelectableTranscript(list);
  },

  shortClock(ts) {
    const cleaned = String(ts).replace(',', '.');
    return cleaned.slice(0, 8);
  },

  escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  },

  bindSearchEvent() {
    const searchInput = document.getElementById('transcript-search');
    if (!searchInput) return;

    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase();
      document.querySelectorAll('#transcript-feed .transcript-item').forEach((item) => {
        const text = item.querySelector('.transcript-text')?.textContent.toLowerCase() || '';
        item.style.display = text.includes(query) ? 'flex' : 'none';
      });
    });
  },

  bindMediaSync() {
    const player = document.getElementById('active-media-player');
    if (!player) return;

    player.addEventListener('timeupdate', () => {
      const current = player.currentTime;
      const items = document.querySelectorAll('#transcript-feed .transcript-item');
      let active = null;
      items.forEach((item) => {
        const start = parseFloat(item.dataset.seconds);
        const end = parseFloat(item.dataset.endSeconds || start + 3);
        if (current >= start && current < end) active = item;
      });
      if (active) {
        items.forEach((i) => i.classList.remove('active'));
        active.classList.add('active');
      }
    });
  },

  parseTimestampToSeconds(ts) {
    const parts = String(ts).replace(',', '.').split(':');
    if (parts.length === 3) {
      const h = parseFloat(parts[0]);
      const m = parseFloat(parts[1]);
      const s = parseFloat(parts[2]);
      return h * 3600 + m * 60 + s;
    }
    if (parts.length === 2) {
      return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
    }
    return parseFloat(ts) || 0;
  }
};
