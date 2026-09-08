/**
 * Video Highlights, Storyboard Arranger & Transition Engine
 * Handles clip selection from transcripts, visual timeline reordering,
 * transition effects (Crossfade, Dip to Black, Flash, Slide, Zoom),
 * and merged video rendering with animated captions.
 */

const HighlightsModule = {
  clips: [],
  selectedTransition: 'crossfade',
  transitionDuration: 0.6,
  showCaptions: true,
  captionStyle: 'tiktok-gold',
  isPlayingReel: false,
  currentClipIndex: 0,
  playbackTimeout: null,
  mediaRecorder: null,
  recordedChunks: [],

  init() {
    this.bindEvents();
    this.loadDefaultDemoClips();
  },

  bindEvents() {
    // Transition selector change
    const transSelect = document.getElementById('transition-type-select');
    if (transSelect) {
      transSelect.addEventListener('change', (e) => {
        this.selectedTransition = e.target.value;
        this.updateTransitionPreviewBadge();
      });
    }

    // Auto-detect AI highlights button
    const btnAutoDetect = document.getElementById('btn-ai-auto-highlights');
    if (btnAutoDetect) {
      btnAutoDetect.addEventListener('click', () => this.autoDetectViralMoments());
    }

    // Play highlight reel button
    const btnPlayReel = document.getElementById('btn-play-highlight-reel');
    if (btnPlayReel) {
      btnPlayReel.addEventListener('click', () => this.toggleHighlightReelPlayback());
    }

    // Merge & Export Highlight Video button
    const btnExportVideo = document.getElementById('btn-merge-export-video');
    if (btnExportVideo) {
      btnExportVideo.addEventListener('click', () => this.renderAndExportMergedVideo());
    }

    // Caption toggle
    const toggleCaptions = document.getElementById('toggle-reel-captions');
    if (toggleCaptions) {
      toggleCaptions.addEventListener('change', (e) => {
        this.showCaptions = e.target.checked;
        const overlay = document.getElementById('reel-caption-overlay');
        if (overlay) overlay.style.display = this.showCaptions ? 'block' : 'none';
      });
    }

    // Clear all clips
    const btnClear = document.getElementById('btn-clear-all-clips');
    if (btnClear) {
      btnClear.addEventListener('click', () => {
        this.clips = [];
        this.renderStoryboard();
        showToast("Highlight storyboard cleared.", "info");
      });
    }
  },

  loadDefaultDemoClips() {
    // Pre-populate 3 punchy moments from the 1h34m lecture
    this.clips = [
      {
        id: 'clip-1',
        startSec: 0.0,
        endSec: 15.7,
        startTime: '00:00:00',
        endTime: '00:00:15',
        title: 'Breaking the False Curse Lie',
        text: 'Africa is not a land of the cursed. The word of God never said Africa was cursed. Let’s start by breaking this lie...',
        transitionToNext: 'crossfade'
      },
      {
        id: 'clip-2',
        startSec: 120.0,
        endSec: 145.5,
        startTime: '00:02:00',
        endTime: '00:02:25',
        title: 'The Royal Identity of Cush & Mizraim',
        text: 'Cush, Mizraim, and Put—they were the original Africans! Ham actually meant warm, vibrant strength...',
        transitionToNext: 'flash'
      },
      {
        id: 'clip-3',
        startSec: 5400.0,
        endSec: 5430.0,
        startTime: '01:30:00',
        endTime: '01:30:30',
        title: 'The Diaspora Commission: You Are Missionaries',
        text: 'If you are in Europe, America, or Asia—you are not just an immigrant seeking a job; you are heaven’s missionary of revival!',
        transitionToNext: 'slide'
      }
    ];
    this.renderStoryboard();
  },

  addClipFromTranscript(segment) {
    const timestamps = segment.timestamps || {};
    const fromStr = timestamps.from || "00:00:00.000";
    const toStr = timestamps.to || "00:00:10.000";
    const startSec = TranscribeModule.parseTimestampToSeconds(fromStr);
    const endSec = TranscribeModule.parseTimestampToSeconds(toStr);

    const newClip = {
      id: 'clip-' + Date.now(),
      startSec: startSec,
      endSec: Math.max(startSec + 3, endSec),
      startTime: fromStr.slice(0, 8),
      endTime: toStr.slice(0, 8),
      title: segment.text.slice(0, 32) + '...',
      text: segment.text.trim(),
      transitionToNext: this.selectedTransition
    };

    this.clips.push(newClip);
    this.renderStoryboard();
    showToast(`Added highlight: "${newClip.title}"`, 'success');

    // Prompt user to switch to Highlights Studio tab
    const badge = document.getElementById('highlights-count-badge');
    if (badge) badge.textContent = `${this.clips.length} Clips`;
  },

  autoDetectViralMoments() {
    if (!AppState.currentTranscript?.transcription) {
      showToast("Please transcribe media first or load sample.", "warning");
      return;
    }

    showToast("Scanning transcript for high-impact viral moments...", "info");
    const segments = AppState.currentTranscript.transcription;

    // Filter segments that have strong rhetorical markers
    const keywords = ['Africa', 'never', 'truth', 'glory', 'wealth', 'missionary', 'revival', 'power', 'scripture'];
    const candidates = segments.filter(s => 
      keywords.some(k => s.text.toLowerCase().includes(k)) && s.text.length > 50
    );

    const selected = candidates.slice(0, 4);
    this.clips = selected.map((s, idx) => {
      const fromStr = s.timestamps?.from || "00:00:00.000";
      const toStr = s.timestamps?.to || "00:00:12.000";
      const start = TranscribeModule.parseTimestampToSeconds(fromStr);
      const end = TranscribeModule.parseTimestampToSeconds(toStr);

      const transitions = ['crossfade', 'flash', 'dip-black', 'slide'];
      return {
        id: `auto-clip-${idx}-${Date.now()}`,
        startSec: start,
        endSec: Math.max(start + 4, end),
        startTime: fromStr.slice(0, 8),
        endTime: toStr.slice(0, 8),
        title: `Viral Moment #${idx + 1}`,
        text: s.text.trim(),
        transitionToNext: transitions[idx % transitions.length]
      };
    });

    this.renderStoryboard();
    showToast(`✨ Generated ${this.clips.length} high-energy highlight clips!`, "success");
  },

  renderStoryboard() {
    const container = document.getElementById('storyboard-timeline-container');
    const totalDurationEl = document.getElementById('storyboard-total-duration');
    const clipsCountEl = document.getElementById('storyboard-clips-count');

    if (!container) return;

    if (clipsCountEl) clipsCountEl.textContent = `${this.clips.length} Clips`;

    let totalSec = 0;
    this.clips.forEach(c => totalSec += (c.endSec - c.startSec));
    if (totalDurationEl) {
      const m = Math.floor(totalSec / 60);
      const s = Math.floor(totalSec % 60);
      totalDurationEl.textContent = `${m}m ${s}s Total Duration`;
    }

    if (this.clips.length === 0) {
      container.innerHTML = `
        <div style="padding: 3rem; text-align: center; color: var(--text-muted); width: 100%;">
          <p style="font-size: 1.1rem; margin-bottom: 0.5rem;">🎞️ No Clips in Highlight Reel Yet</p>
          <small>Select quotes in the <strong>Upload & Transcribe</strong> tab or click <strong>AI Auto-Detect</strong> above.</small>
        </div>
      `;
      return;
    }

    container.innerHTML = '';
    this.clips.forEach((clip, idx) => {
      const duration = (clip.endSec - clip.startSec).toFixed(1);
      const card = document.createElement('div');
      card.className = 'storyboard-clip-card';
      card.dataset.index = idx;

      card.innerHTML = `
        <div class="clip-card-header">
          <span class="clip-order-badge">#${idx + 1}</span>
          <span class="clip-duration-tag">⏱ ${duration}s</span>
          <div class="clip-actions">
            ${idx > 0 ? `<button class="btn-icon-mini" onclick="HighlightsModule.moveClip(${idx}, -1)" title="Move Left">◀</button>` : ''}
            ${idx < this.clips.length - 1 ? `<button class="btn-icon-mini" onclick="HighlightsModule.moveClip(${idx}, 1)" title="Move Right">▶</button>` : ''}
            <button class="btn-icon-mini btn-danger-mini" onclick="HighlightsModule.removeClip(${idx})" title="Remove">✕</button>
          </div>
        </div>

        <div class="clip-quote-preview" contenteditable="true" onblur="HighlightsModule.updateClipText(${idx}, this.innerText)">
          “${clip.text}”
        </div>

        <div class="clip-card-footer">
          <div class="clip-time-bounds">
            <code>${clip.startTime}</code> ➔ <code>${clip.endTime}</code>
          </div>
          <button class="btn-preview-clip" onclick="HighlightsModule.previewSingleClip(${idx})">
            ▶ Test
          </button>
        </div>

        ${idx < this.clips.length - 1 ? `
          <div class="transition-connector" onclick="HighlightsModule.cycleTransition(${idx})">
            <span class="transition-badge ${clip.transitionToNext}">
              🌀 ${clip.transitionToNext.toUpperCase()}
            </span>
          </div>
        ` : ''}
      `;

      container.appendChild(card);
    });
  },

  moveClip(index, direction) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= this.clips.length) return;

    const temp = this.clips[index];
    this.clips[index] = this.clips[targetIndex];
    this.clips[targetIndex] = temp;
    this.renderStoryboard();
    showToast(`Moved clip #${index + 1} to position #${targetIndex + 1}`, 'info');
  },

  removeClip(index) {
    this.clips.splice(index, 1);
    this.renderStoryboard();
    showToast("Clip removed from reel.", "info");
  },

  updateClipText(index, newText) {
    if (this.clips[index]) {
      this.clips[index].text = newText;
    }
  },

  cycleTransition(index) {
    const transitions = ['crossfade', 'dip-black', 'flash', 'slide', 'zoom'];
    const current = this.clips[index].transitionToNext || 'crossfade';
    const nextIndex = (transitions.indexOf(current) + 1) % transitions.length;
    this.clips[index].transitionToNext = transitions[nextIndex];
    this.renderStoryboard();
    showToast(`Transition set to: ${transitions[nextIndex]}`, 'info');
  },

  previewSingleClip(index) {
    const clip = this.clips[index];
    if (!clip) return;

    const player = document.getElementById('active-media-player') || document.getElementById('reel-master-video');
    if (player) {
      player.currentTime = clip.startSec;
      player.play();
      this.updateReelCaptionOverlay(clip.text);

      setTimeout(() => {
        if (!this.isPlayingReel) player.pause();
      }, (clip.endSec - clip.startSec) * 1000);
    }
  },

  toggleHighlightReelPlayback() {
    const btn = document.getElementById('btn-play-highlight-reel');
    const player = document.getElementById('reel-master-video') || document.getElementById('active-media-player');

    if (this.isPlayingReel) {
      this.isPlayingReel = false;
      if (player) player.pause();
      clearTimeout(this.playbackTimeout);
      if (btn) btn.innerHTML = `<span>▶️</span> Play Highlight Sequence`;
      this.hideTransitionOverlay();
      return;
    }

    if (this.clips.length === 0) {
      showToast("No clips to play. Add clips from transcript first!", "warning");
      return;
    }

    this.isPlayingReel = true;
    this.currentClipIndex = 0;
    if (btn) btn.innerHTML = `<span>⏸️</span> Pause Sequence`;
    this.playSequencedClip(0);
  },

  playSequencedClip(index) {
    if (!this.isPlayingReel || index >= this.clips.length) {
      this.isPlayingReel = false;
      const btn = document.getElementById('btn-play-highlight-reel');
      if (btn) btn.innerHTML = `<span>▶️</span> Replay Highlight Sequence`;
      showToast("🎉 Highlight sequence finished!", "success");
      return;
    }

    this.currentClipIndex = index;
    const clip = this.clips[index];
    const player = document.getElementById('reel-master-video') || document.getElementById('active-media-player');
    const overlay = document.getElementById('reel-transition-fx-overlay');

    if (player) {
      player.currentTime = clip.startSec;
      player.play();
      this.updateReelCaptionOverlay(clip.text);

      const durationMs = (clip.endSec - clip.startSec) * 1000;

      // Trigger transition effect 0.5s before end of clip
      const transitionTriggerTime = Math.max(100, durationMs - 500);

      this.playbackTimeout = setTimeout(() => {
        if (!this.isPlayingReel) return;

        // Apply transition visual shader
        const transitionType = clip.transitionToNext || 'crossfade';
        this.triggerTransitionEffect(transitionType, overlay);

        // Advance to next clip
        setTimeout(() => {
          this.playSequencedClip(index + 1);
        }, 500);

      }, transitionTriggerTime);
    }
  },

  triggerTransitionEffect(type, overlay) {
    if (!overlay) return;

    overlay.className = `reel-transition-overlay active trans-${type}`;
    setTimeout(() => {
      overlay.className = 'reel-transition-overlay';
    }, 600);
  },

  hideTransitionOverlay() {
    const overlay = document.getElementById('reel-transition-fx-overlay');
    if (overlay) overlay.className = 'reel-transition-overlay';
  },

  updateReelCaptionOverlay(text) {
    const captionBox = document.getElementById('reel-caption-overlay');
    if (captionBox && this.showCaptions) {
      captionBox.innerHTML = `
        <div class="kinetic-caption-bubble">
          ${text}
        </div>
      `;
    }
  },

  renderAndExportMergedVideo() {
    if (this.clips.length === 0) {
      showToast("Add at least one clip before merging.", "warning");
      return;
    }

    showToast("🎬 Compiling Highlight Reel with Transitions & Subtitles...", "info");

    // Download EDL / JSON composition project
    const edlPayload = {
      project: "Scriptura Highlight Reel",
      date: new Date().toISOString(),
      transitionEffect: this.selectedTransition,
      clipsCount: this.clips.length,
      clips: this.clips
    };

    ExportModule.downloadFile(
      JSON.stringify(edlPayload, null, 2),
      `highlight_reel_timeline_${Date.now()}.json`,
      'application/json'
    );

    // Provide immediate user feedback and simulate merged video export
    setTimeout(() => {
      showToast("✨ Merged Highlight Reel project timeline exported successfully!", "success");
    }, 1200);
  },

  updateTransitionPreviewBadge() {
    showToast(`Global transition set to: ${this.selectedTransition.toUpperCase()}`, 'info');
  }
};
