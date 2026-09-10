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
    if (file.size > MAX_UPLOAD_BYTES) {
      showToast('That file is over 2 GB. Please compress it or upload a shorter recording.', 'warning');
      return;
    }

    showToast('Clearing the previous transcript so this file can upload…', 'info');
    await prepareForNewUpload({ silent: true });
    logActivity(`New upload: ${file.name}`);
    showToast(`Workspace cleared. Loading ${file.name}…`, 'info');
    setWorkspaceStatus('Loading new file');

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
    setWorkspaceStatus('Uploading');
    updateDashMeters();

    this.bindMediaSync();
    HighlightsModule.attachSourceMedia(objectUrl, AppState.mediaIsVideo);

    const progressWrap = document.getElementById('upload-progress');
    const progressBar = document.getElementById('upload-progress-bar');
    const progressLabel = document.getElementById('upload-progress-label');
    if (progressWrap) progressWrap.hidden = false;
    if (progressBar) progressBar.style.width = '0%';
    if (progressLabel) progressLabel.textContent = 'Uploading to a temporary folder…';

    try {
      const data = await this.uploadToServer(file, (pct) => {
        if (progressBar) progressBar.style.width = `${pct}%`;
        if (progressLabel) progressLabel.textContent = `Uploading ${pct}% of ${(file.size / (1024 * 1024)).toFixed(0)} MB`;
      });
      if (data && data.success) {
        AppState.mediaFile = data;
        if (data.sessionId) {
          AppState.sessionId = data.sessionId;
          try { localStorage.setItem(SESSION_STORAGE_KEY, data.sessionId); } catch (e) {}
        }
        if (progressLabel) progressLabel.textContent = 'On the server until you finish (or 4 hours)';
        if (progressBar) progressBar.style.width = '100%';
        showToast(`${file.name} is ready. Transcribe it to replace any old lines.`, 'success');
        logActivity('File is on the server. Ready to transcribe.');
        setWorkspaceStatus('Ready to transcribe');
        updateDashMeters();
      } else {
        throw new Error((data && data.error) || 'Upload failed');
      }
    } catch (e) {
      AppState.mediaFile = { filename: file.name, localOnly: true };
      if (progressLabel) progressLabel.textContent = 'Kept only in this browser tab';
      showToast(e.message || 'File is ready in this browser. Server upload was skipped.', 'info');
      setWorkspaceStatus('File in this browser');
      updateDashMeters();
    }
  },

  uploadToServer(file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload');
      xhr.setRequestHeader('X-Session-Id', getSessionId());
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        const pct = Math.min(100, Math.round((event.loaded / event.total) * 100));
        onProgress(pct);
      };
      xhr.onload = () => {
        try {
          const data = JSON.parse(xhr.responseText || '{}');
          if (xhr.status >= 400) {
            reject(new Error(data.error || `Upload failed (${xhr.status})`));
            return;
          }
          resolve(data);
        } catch (err) {
          reject(err);
        }
      };
      xhr.onerror = () => reject(new Error('Network error during upload'));
      const formData = new FormData();
      formData.append('file', file);
      formData.append('filename', file.name);
      formData.append('sessionId', getSessionId());
      xhr.send(formData);
    });
  },

  async runTranscription() {
    if (!AppState.mediaFile && !AppState.mediaBlobUrl) {
      showToast('Upload a recording first. The last transcript will stay cleared until this file is transcribed.', 'warning');
      return;
    }

    const runBtn = document.getElementById('btn-run-transcribe');
    if (runBtn) {
      runBtn.disabled = true;
      runBtn.textContent = 'Transcribing…';
    }

    showToast('Transcribing this file with timestamps…', 'info');
    logActivity('Transcription started.');

    try {
      const res = await fetch('/api/transcribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': getSessionId()
        },
        body: JSON.stringify({
          filePath: AppState.mediaFile ? AppState.mediaFile.filePath : null,
          sessionId: getSessionId()
        })
      });
      const data = await res.json();
      if (data.success && data.data && data.source !== 'preloaded_recording') {
        AppState.currentTranscript = data.data;
        this.renderTranscriptList(data.data.transcription);
        showToast('Transcript is ready for this file. Open Clips to cut moments.', 'success');
        logActivity(`${data.data.transcription.length} timestamped lines ready.`);
        setWorkspaceStatus('Transcript ready');
        updateDashMeters();
      } else if (data.success && data.source === 'preloaded_recording') {
        showToast('The server did not receive this file. Try uploading again, then transcribe.', 'warning');
        logActivity('Transcription skipped — no uploaded file on the server.');
      } else {
        showToast((data && data.error) || 'Transcription failed. Upload the file again.', 'warning');
      }
    } catch (e) {
      showToast('Could not transcribe this file. Check the upload, then try again.', 'warning');
    } finally {
      if (runBtn) {
        runBtn.disabled = false;
        runBtn.textContent = 'Transcribe this file';
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
