/**
 * Clip studio: select timestamped transcript text, then crop that range.
 */

const HighlightsModule = {
  clips: [],
  segments: [],
  range: { from: null, to: null },
  dragging: false,
  dragOrigin: null,
  cropping: false,

  init() {
    this.bindEvents();
    this.renderLibrary();
    this.updateToolbar();
  },

  bindEvents() {
    const btnCrop = document.getElementById('btn-crop-selection');
    if (btnCrop) btnCrop.addEventListener('click', () => this.cropSelected());

    const btnClear = document.getElementById('btn-clear-selection');
    if (btnClear) btnClear.addEventListener('click', () => this.clearSelection());

    const btnSuggest = document.getElementById('btn-ai-auto-highlights');
    if (btnSuggest) btnSuggest.addEventListener('click', () => this.suggestStrongLines());

    const btnClearAll = document.getElementById('btn-clear-all-clips');
    if (btnClearAll) {
      btnClearAll.addEventListener('click', () => {
        this.clips.forEach((clip) => {
          if (clip.revokeOnClear && clip.url) URL.revokeObjectURL(clip.url);
        });
        this.clips = [];
        this.renderLibrary();
        showToast('Clip library cleared.', 'info');
      });
    }

    document.addEventListener('mouseup', () => {
      this.dragging = false;
      this.dragOrigin = null;
    });

    const clipFeed = document.getElementById('clip-transcript-feed');
    if (clipFeed) {
      clipFeed.addEventListener('mouseup', () => this.captureNativeTextSelection(clipFeed));
    }
  },

  onTabEnter() {
    if (AppState.currentTranscript?.transcription) {
      this.renderSelectableTranscript(AppState.currentTranscript.transcription);
    }
    this.syncSourcePlayer();
    this.updateToolbar();
  },

  attachSourceMedia(url, isVideo) {
    const video = document.getElementById('clip-source-video');
    const wrapper = document.getElementById('reel-player-container');
    const badge = document.getElementById('clip-source-badge');
    if (video) {
      video.src = url || '';
      video.style.display = isVideo === false ? 'none' : 'block';
    }
    if (wrapper) wrapper.classList.toggle('is-empty', !url);
    if (badge) badge.textContent = url ? 'Source loaded' : 'Waiting for a file';
  },

  syncSourcePlayer() {
    const studio = document.getElementById('active-media-player');
    const clipPlayer = document.getElementById('clip-source-video');
    if (studio?.src && clipPlayer && clipPlayer.src !== studio.src) {
      clipPlayer.src = studio.src;
    }
    const wrapper = document.getElementById('reel-player-container');
    const hasSrc = Boolean(clipPlayer?.src || AppState.mediaBlobUrl);
    if (wrapper) wrapper.classList.toggle('is-empty', !hasSrc);
    const badge = document.getElementById('clip-source-badge');
    if (badge) badge.textContent = hasSrc ? 'Source loaded' : 'Waiting for a file';
  },

  renderSelectableTranscript(segments) {
    this.segments = segments || [];
    const feed = document.getElementById('clip-transcript-feed');
    if (!feed) return;

    feed.innerHTML = '';
    if (!this.segments.length) {
      feed.innerHTML = `<div class="clip-empty">Transcribe a recording first. Lines will appear here with their start and end times.</div>`;
      return;
    }

    this.segments.forEach((seg, idx) => {
      const fromStr = seg.timestamps?.from || '00:00:00.000';
      const toStr = seg.timestamps?.to || '00:00:00.000';
      const startSec = TranscribeModule.parseTimestampToSeconds(fromStr);
      const endSec = TranscribeModule.parseTimestampToSeconds(toStr);

      const line = document.createElement('div');
      line.className = 'transcript-line';
      line.dataset.index = String(idx);
      line.dataset.start = String(startSec);
      line.dataset.end = String(endSec);
      line.innerHTML = `
        <div class="transcript-line-left">
          <span class="timestamp-badge">${formatClock(startSec)}</span>
          <span class="line-end-time">${formatClock(endSec)}</span>
        </div>
        <div class="transcript-line-text">${TranscribeModule.escapeHtml((seg.text || '').trim())}</div>
      `;

      line.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        this.dragging = true;
        this.dragOrigin = idx;
        if (e.shiftKey && this.range.from != null) {
          this.setRange(this.range.from, idx);
        } else {
          this.setRange(idx, idx);
        }
      });

      line.addEventListener('mouseenter', () => {
        if (this.dragging && this.dragOrigin != null) {
          this.setRange(this.dragOrigin, idx);
        }
      });

      line.addEventListener('click', (e) => {
        const player = document.getElementById('clip-source-video') || document.getElementById('active-media-player');
        if (player?.src && !this.dragging) {
          player.currentTime = startSec;
        }
        e.preventDefault();
      });

      feed.appendChild(line);
    });

    this.paintSelection();
  },

  captureNativeTextSelection(feed) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !feed.contains(sel.anchorNode)) return;
    const lines = [...feed.querySelectorAll('.transcript-line')];
    const hit = lines.filter((el) => sel.containsNode(el, true));
    if (!hit.length) return;
    const from = Number(hit[0].dataset.index);
    const to = Number(hit[hit.length - 1].dataset.index);
    this.setRange(from, to);
  },

  setRange(a, b) {
    const from = Math.min(a, b);
    const to = Math.max(a, b);
    this.range = { from, to };
    this.paintSelection();
    this.updateToolbar();
  },

  clearSelection() {
    this.range = { from: null, to: null };
    this.paintSelection();
    this.updateToolbar();
  },

  paintSelection() {
    document.querySelectorAll('#clip-transcript-feed .transcript-line').forEach((line) => {
      const idx = Number(line.dataset.index);
      const selected = this.range.from != null && idx >= this.range.from && idx <= this.range.to;
      line.classList.toggle('selected', selected);
    });
  },

  getSelectedBounds() {
    if (this.range.from == null || !this.segments.length) return null;
    const startSeg = this.segments[this.range.from];
    const endSeg = this.segments[this.range.to];
    if (!startSeg || !endSeg) return null;

    const startSec = TranscribeModule.parseTimestampToSeconds(startSeg.timestamps?.from || '00:00:00');
    const endSec = TranscribeModule.parseTimestampToSeconds(endSeg.timestamps?.to || startSeg.timestamps?.to || '00:00:03');
    const text = this.segments
      .slice(this.range.from, this.range.to + 1)
      .map((s) => (s.text || '').trim())
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      startSec,
      endSec: Math.max(startSec + 0.4, endSec),
      text,
      lineCount: this.range.to - this.range.from + 1
    };
  },

  updateToolbar() {
    const bar = document.getElementById('selection-toolbar');
    const rangeLabel = document.getElementById('selection-range-label');
    const durationLabel = document.getElementById('selection-duration-label');
    const cropBtn = document.getElementById('btn-crop-selection');
    const bounds = this.getSelectedBounds();

    if (!bounds) {
      if (bar) bar.classList.remove('is-ready');
      if (rangeLabel) rangeLabel.textContent = 'Nothing selected';
      if (durationLabel) durationLabel.textContent = 'Highlight transcript lines to set in and out points';
      if (cropBtn) cropBtn.disabled = true;
      return;
    }

    const duration = bounds.endSec - bounds.startSec;
    if (bar) bar.classList.add('is-ready');
    if (rangeLabel) rangeLabel.textContent = `${formatClock(bounds.startSec)} – ${formatClock(bounds.endSec)}`;
    if (durationLabel) {
      durationLabel.textContent = `${duration.toFixed(1)}s from ${bounds.lineCount} line${bounds.lineCount === 1 ? '' : 's'}`;
    }
    if (cropBtn) cropBtn.disabled = this.cropping;
  },

  suggestStrongLines() {
    if (!this.segments.length) {
      showToast('Transcribe a recording first.', 'warning');
      return;
    }

    const scored = this.segments.map((seg, idx) => {
      const text = (seg.text || '').trim();
      const lower = text.toLowerCase();
      let score = 0;
      if (text.length > 40 && text.length < 180) score += 2;
      if (/[.!?]$/.test(text)) score += 1;
      if (/\b(never|truth|africa|god|scripture|glory|revival|curse|blessed|you are)\b/i.test(lower)) score += 2;
      if (/\b(um|uh|you know)\b/i.test(lower)) score -= 1;
      return { idx, score, text };
    }).filter((s) => s.score >= 3);

    scored.sort((a, b) => b.score - a.score);
    const pick = scored[0];
    if (!pick) {
      showToast('No especially strong line stood out. Select a stretch by hand.', 'info');
      return;
    }

    const end = Math.min(this.segments.length - 1, pick.idx + 2);
    this.setRange(pick.idx, end);

    const el = document.querySelector(`#clip-transcript-feed .transcript-line[data-index="${pick.idx}"]`);
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    showToast('Selected a short stretch around a strong line. Adjust it, then cut.', 'success');
  },

  async cropSelected() {
    const bounds = this.getSelectedBounds();
    if (!bounds) {
      showToast('Select transcript lines first.', 'warning');
      return;
    }

    if (!AppState.mediaBlobUrl && !AppState.mediaFile?.filePath && !document.getElementById('clip-source-video')?.src) {
      showToast('Upload a video on Transcribe so those timestamps can be cut from the file.', 'warning');
      return;
    }

    this.cropping = true;
    this.updateToolbar();
    const cropBtn = document.getElementById('btn-crop-selection');
    if (cropBtn) cropBtn.textContent = 'Cutting clip…';

    try {
      let clip = await this.cropOnServer(bounds);
      if (!clip) clip = await this.cropInBrowser(bounds);
      if (!clip) throw new Error('Could not cut this range');

      this.clips.unshift(clip);
      this.renderLibrary();
      showToast(`Clip ready: ${formatClock(bounds.startSec)}–${formatClock(bounds.endSec)}`, 'success');
    } catch (err) {
      console.error(err);
      showToast('Could not cut that clip. Check that a video is loaded.', 'warning');
    } finally {
      this.cropping = false;
      if (cropBtn) cropBtn.textContent = 'Cut clip from timestamps';
      this.updateToolbar();
    }
  },

  async cropOnServer(bounds) {
    if (!AppState.mediaFile?.filePath) return null;
    try {
      const res = await fetch('/api/crop-clip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: AppState.mediaFile.filePath,
          startSec: bounds.startSec,
          endSec: bounds.endSec,
          label: bounds.text.slice(0, 40)
        })
      });
      const data = await res.json();
      if (!data.success || !data.clipUrl) return null;
      return {
        id: `clip-${Date.now()}`,
        url: data.clipUrl,
        filename: data.filename || `clip_${Math.floor(bounds.startSec)}-${Math.floor(bounds.endSec)}.mp4`,
        startSec: bounds.startSec,
        endSec: bounds.endSec,
        text: bounds.text,
        revokeOnClear: false
      };
    } catch (e) {
      return null;
    }
  },

  async cropInBrowser(bounds) {
    const studio = document.getElementById('active-media-player');
    const clipPlayer = document.getElementById('clip-source-video');
    const video = (studio && studio.tagName === 'AUDIO') ? studio : (clipPlayer || studio);
    if (!video || !video.src) return null;
    if (video.tagName === 'AUDIO') {
      return this.cropAudioElement(video, bounds);
    }

    await this.seekElement(video, bounds.startSec);

    const stream = video.captureStream ? video.captureStream() : video.mozCaptureStream?.();
    if (!stream) return null;

    const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
      .find((type) => window.MediaRecorder && MediaRecorder.isTypeSupported(type)) || 'video/webm';

    const chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType: mime });
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size) chunks.push(e.data);
    };

    const blob = await new Promise((resolve, reject) => {
      recorder.onerror = () => reject(new Error('Recorder failed'));
      recorder.onstop = () => resolve(new Blob(chunks, { type: mime }));
      recorder.start(80);
      const playAttempt = video.play();
      if (playAttempt && playAttempt.catch) playAttempt.catch(() => {});

      const watch = () => {
        if (video.currentTime >= bounds.endSec - 0.05 || video.ended) {
          if (recorder.state === 'recording') recorder.stop();
          video.pause();
          return;
        }
        requestAnimationFrame(watch);
      };
      requestAnimationFrame(watch);

      window.setTimeout(() => {
        if (recorder.state === 'recording') {
          recorder.stop();
          video.pause();
        }
      }, Math.ceil((bounds.endSec - bounds.startSec) * 1000) + 1200);
    });

    const url = URL.createObjectURL(blob);
    return {
      id: `clip-${Date.now()}`,
      url,
      filename: `clip_${formatClock(bounds.startSec).replace(':', '-')}_${formatClock(bounds.endSec).replace(':', '-')}.webm`,
      startSec: bounds.startSec,
      endSec: bounds.endSec,
      text: bounds.text,
      revokeOnClear: true
    };
  },

  async cropAudioElement(audio, bounds) {
    await this.seekElement(audio, bounds.startSec);
    const stream = audio.captureStream ? audio.captureStream() : null;
    if (!stream) return null;

    const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
    const chunks = [];
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size) chunks.push(e.data);
    };

    const blob = await new Promise((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: mime || 'audio/webm' }));
      recorder.start();
      audio.play().catch(() => {});
      window.setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop();
        audio.pause();
      }, Math.ceil((bounds.endSec - bounds.startSec) * 1000) + 200);
    });

    const url = URL.createObjectURL(blob);
    return {
      id: `clip-${Date.now()}`,
      url,
      filename: `clip_${Math.floor(bounds.startSec)}s.webm`,
      startSec: bounds.startSec,
      endSec: bounds.endSec,
      text: bounds.text,
      revokeOnClear: true
    };
  },

  seekElement(el, time) {
    return new Promise((resolve) => {
      const done = () => {
        el.removeEventListener('seeked', done);
        resolve();
      };
      el.addEventListener('seeked', done);
      el.pause();
      el.currentTime = time;
      if (Math.abs(el.currentTime - time) < 0.05) done();
    });
  },

  renderLibrary() {
    const library = document.getElementById('clip-library');
    const stat = document.getElementById('clip-count-stat');
    if (stat) stat.textContent = `${this.clips.length} clip${this.clips.length === 1 ? '' : 's'}`;
    if (!library) return;

    if (!this.clips.length) {
      library.innerHTML = `
        <div class="clip-empty">
          No clips yet. Select a stretch of timestamped text above, then cut it from the video.
        </div>`;
      return;
    }

    library.innerHTML = '';
    this.clips.forEach((clip, idx) => {
      const card = document.createElement('article');
      card.className = 'clip-result-card';
      const mediaTag = AppState.mediaIsVideo === false
        ? `<audio controls src="${clip.url}"></audio>`
        : `<video controls playsinline src="${clip.url}"></video>`;

      card.innerHTML = `
        ${mediaTag}
        <div class="clip-result-body">
          <div class="clip-result-times">${formatClock(clip.startSec)} – ${formatClock(clip.endSec)}</div>
          <p class="clip-result-quote">${TranscribeModule.escapeHtml(clip.text)}</p>
          <div class="clip-result-actions">
            <a class="btn btn-primary btn-sm" href="${clip.url}" download="${clip.filename}">Download</a>
            <button class="btn btn-secondary btn-sm" type="button" data-remove="${idx}">Remove</button>
          </div>
        </div>
      `;
      card.querySelector('[data-remove]').addEventListener('click', () => {
        const removed = this.clips.splice(idx, 1)[0];
        if (removed?.revokeOnClear && removed.url) URL.revokeObjectURL(removed.url);
        this.renderLibrary();
      });
      library.appendChild(card);
    });
  },

  // Kept so older inline handlers do not throw if a cached page still calls them
  addClipFromTranscript() {},
  loadDefaultDemoClips() {},
  renderStoryboard() {},
  moveClip() {},
  removeClip() {},
  updateClipText() {},
  cycleTransition() {},
  previewSingleClip() {},
  toggleHighlightReelPlayback() {},
  renderAndExportMergedVideo() {}
};
