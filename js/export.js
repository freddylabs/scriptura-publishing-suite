/**
 * Export & Publication Packaging Module
 * Handles Markdown, PDF Print, Subtitles, and e-Book exports
 */

const ExportModule = {
  init() {
    this.bindExportButtons();
  },

  bindExportButtons() {
    // Markdown export
    const btnMd = document.getElementById('btn-export-markdown');
    if (btnMd) {
      btnMd.addEventListener('click', () => this.exportMarkdown());
    }

    // PDF / Print export
    const btnPdf = document.getElementById('btn-export-pdf');
    if (btnPdf) {
      btnPdf.addEventListener('click', () => window.print());
    }

    // SRT Subtitles export
    const btnSrt = document.getElementById('btn-export-srt');
    if (btnSrt) {
      btnSrt.addEventListener('click', () => this.exportSRT());
    }

    // Plain Text export
    const btnTxt = document.getElementById('btn-export-txt');
    if (btnTxt) {
      btnTxt.addEventListener('click', () => this.exportTXT());
    }

    // JSON export
    const btnJson = document.getElementById('btn-export-json');
    if (btnJson) {
      btnJson.addEventListener('click', () => this.exportJSON());
    }
  },

  exportMarkdown() {
    if (!AppState.currentBook) {
      showToast("No book manuscript available to export.", "warning");
      return;
    }

    showToast("Generating Markdown publication manuscript...", "info");

    const meta = AppState.currentBook.meta || {};
    const chapters = AppState.currentBook.chapters || [];

    let md = `# ${meta.title || "Book Title"}\n`;
    md += `### ${meta.subtitle || ""}\n\n`;
    md += `**Author:** ${meta.author || "Author"}  \n`;
    md += `**Genre:** ${meta.genre || ""}  \n`;
    md += `**Publication Year:** ${meta.publicationDate || "2026"}  \n\n`;
    md += `---\n\n## Table of Contents\n\n`;

    chapters.forEach(c => {
      md += `- **${c.number}:** ${c.title}\n`;
    });

    md += `\n---\n\n`;

    chapters.forEach(c => {
      md += `## ${c.number}: ${c.title}\n`;
      if (c.subtitle) md += `*${c.subtitle}*\n\n`;
      if (c.epigraph) md += `> ${c.epigraph}\n\n`;

      c.subsections?.forEach(s => {
        md += `### ${s.heading}\n\n${s.content}\n\n`;
      });

      if (c.pullQuote) {
        md += `> 💡 **Core Insight:** ${c.pullQuote}\n\n`;
      }

      if (c.keyTakeaways?.length) {
        md += `#### Key Takeaways\n`;
        c.keyTakeaways.forEach(k => md += `- ${k}\n`);
        md += `\n`;
      }

      if (c.discussionQuestions?.length) {
        md += `#### Reflection & Discussion\n`;
        c.discussionQuestions.forEach((q, idx) => md += `${idx + 1}. ${q}\n`);
        md += `\n`;
      }

      md += `---\n\n`;
    });

    this.downloadFile(md, `${meta.title || "Manuscript"}.md`, 'text/markdown');
    showToast("Markdown manuscript downloaded successfully!", "success");
  },

  exportSRT() {
    if (!AppState.currentTranscript?.transcription) {
      showToast("No transcript available.", "warning");
      return;
    }

    let srt = '';
    AppState.currentTranscript.transcription.forEach((seg, idx) => {
      const from = (seg.timestamps?.from || "00:00:00.000").replace('.', ',');
      const to = (seg.timestamps?.to || "00:00:00.000").replace('.', ',');
      srt += `${idx + 1}\n${from} --> ${to}\n${seg.text.trim()}\n\n`;
    });

    this.downloadFile(srt, "transcript.srt", "text/plain");
    showToast("SRT subtitles downloaded!", "success");
  },

  exportTXT() {
    if (!AppState.currentTranscript?.transcription) {
      showToast("No transcript available.", "warning");
      return;
    }

    let txt = '';
    AppState.currentTranscript.transcription.forEach(seg => {
      const from = seg.timestamps?.from || "00:00:00.000";
      txt += `[${from.slice(0, 8)}] ${seg.text.trim()}\n`;
    });

    this.downloadFile(txt, "transcript_with_timestamps.txt", "text/plain");
    showToast("Timestamped text transcript downloaded!", "success");
  },

  exportJSON() {
    const payload = {
      book: AppState.currentBook,
      transcript: AppState.currentTranscript
    };
    this.downloadFile(JSON.stringify(payload, null, 2), "book_package.json", "application/json");
    showToast("Complete JSON package downloaded!", "success");
  },

  downloadFile(content, fileName, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
};
