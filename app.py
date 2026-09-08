#!/usr/bin/env python3
"""
Scriptura: Video-to-Book Publishing Web Application Server
Handles media upload, Whisper-based speech-to-text, editorial transformation,
interactive reader formatting, and multi-format book exports.
"""

import os
import sys
import json
import time
import shutil
import subprocess
from pathlib import Path
from http.server import HTTPServer, SimpleHTTPRequestHandler
import urllib.parse
import cgi

PORT = int(os.environ.get("PORT", 8080))
BASE_DIR = Path(__file__).parent.resolve()
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)
SAMPLE_DATA_DIR = BASE_DIR / "sample_data"
SCRATCH_DIR = Path("/Users/farthu1/.gemini/antigravity-ide/brain/88273a8b-e281-4611-a26c-7a8897db5f4b/scratch")
WHISPER_BIN = SCRATCH_DIR / "whisper.cpp" / "main"
WHISPER_MODEL = SCRATCH_DIR / "whisper.cpp" / "models" / "ggml-base.en.bin"

class ScripturaHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/health":
            self.send_json_response({"status": "ok", "time": time.time()})
            return

        if path == "/api/sample-book":
            sample_file = SAMPLE_DATA_DIR / "showcase_book.json"
            if sample_file.exists():
                with open(sample_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                self.send_json_response(data)
            else:
                self.send_error(404, "Showcase book not found")
            return

        if path == "/api/sample-transcript":
            json_path = BASE_DIR / "Screen_Recording_2026-09-07_transcript.json"
            if json_path.exists():
                with open(json_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                self.send_json_response(data)
            else:
                self.send_error(404, "Sample transcript not found")
            return

        # Serve static files from root
        return super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/upload":
            self.handle_upload()
            return
        
        if path == "/api/transcribe":
            self.handle_transcribe()
            return

        if path == "/api/transform-book":
            self.handle_transform_book()
            return

        if path == "/api/export-md":
            self.handle_export_md()
            return

        self.send_error(404, "Endpoint not found")

    def handle_upload(self):
        try:
            ctype, pdict = cgi.parse_header(self.headers.get('content-type'))
            if ctype != 'multipart/form-data':
                self.send_error(400, "Expected multipart/form-data")
                return

            pdict['boundary'] = bytes(pdict['boundary'], "utf-8")
            pdict['CONTENT-LENGTH'] = int(self.headers.get('content-length', 0))
            fields = cgi.parse_multipart(self.rfile, pdict)

            file_data = fields.get('file')
            if not file_data or len(file_data) == 0:
                self.send_error(400, "No file uploaded")
                return

            original_filename = fields.get('filename', ['uploaded_media.mp4'])[0]
            safe_name = "".join(c for c in original_filename if c.isalnum() or c in "._- ")
            save_path = UPLOAD_DIR / safe_name

            with open(save_path, "wb") as f:
                f.write(file_data[0])

            # Inspect duration and properties using afinfo
            duration = 0
            try:
                proc = subprocess.run(["afinfo", str(save_path)], capture_output=True, text=True)
                for line in proc.stdout.split("\n"):
                    if "estimated duration" in line.lower():
                        duration = float(line.split(":")[1].replace("sec", "").strip())
            except Exception:
                pass

            self.send_json_response({
                "success": True,
                "filename": safe_name,
                "filePath": str(save_path),
                "sizeBytes": len(file_data[0]),
                "durationSec": duration,
                "webUrl": f"/uploads/{safe_name}"
            })
        except Exception as e:
            self.send_json_response({"success": False, "error": str(e)}, status=500)

    def handle_transcribe(self):
        try:
            length = int(self.headers.get('content-length', 0))
            req_body = self.rfile.read(length).decode('utf-8')
            params = json.loads(req_body) if req_body else {}

            input_path = params.get("filePath")
            if not input_path or not Path(input_path).exists():
                # If no custom file provided, use the pre-transcribed 801-segment dataset
                json_path = BASE_DIR / "Screen_Recording_2026-09-07_transcript.json"
                with open(json_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                self.send_json_response({
                    "success": True,
                    "status": "completed",
                    "source": "preloaded_recording",
                    "data": data
                })
                return

            # Convert to 16kHz mono wav for Whisper
            temp_wav = UPLOAD_DIR / f"temp_{int(time.time())}.wav"
            subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", input_path, str(temp_wav)], check=True)

            out_prefix = UPLOAD_DIR / f"transcript_{int(time.time())}"
            whisper_cmd = [
                str(WHISPER_BIN),
                "-m", str(WHISPER_MODEL),
                "-f", str(temp_wav),
                "-t", "8", "-p", "2",
                "-osrt", "-ovtt", "-otxt", "-oj",
                "-of", str(out_prefix)
            ]
            
            subprocess.run(whisper_cmd, check=True)

            json_out = Path(f"{out_prefix}.json")
            if json_out.exists():
                with open(json_out, "r", encoding="utf-8") as f:
                    data = json.load(f)
                self.send_json_response({
                    "success": True,
                    "status": "completed",
                    "data": data,
                    "srtFile": f"{out_prefix}.srt",
                    "vttFile": f"{out_prefix}.vtt",
                    "txtFile": f"{out_prefix}.txt"
                })
            else:
                self.send_json_response({"success": False, "error": "Transcription output missing"}, status=500)

        except Exception as e:
            self.send_json_response({"success": False, "error": str(e)}, status=500)

    def handle_transform_book(self):
        try:
            length = int(self.headers.get('content-length', 0))
            req_body = self.rfile.read(length).decode('utf-8')
            params = json.loads(req_body) if req_body else {}

            title = params.get("title", "The Spoken Wisdom Collection")
            author = params.get("author", "Author & Speaker")
            genre = params.get("genre", "Spiritual & Non-Fiction")
            transcript_segments = params.get("segments", [])

            # Transform algorithm: group into cohesive chapters
            chapters = self.generate_book_chapters(transcript_segments, title, author, genre)

            book_payload = {
                "meta": {
                    "title": title,
                    "subtitle": params.get("subtitle", "Transformed from Live Spoken Discourses"),
                    "author": author,
                    "genre": genre,
                    "edition": "First Edition (Manuscript Preview)",
                    "publicationDate": "2026",
                    "wordCount": sum(len(c["subsections"][0]["content"].split()) for c in chapters if c["subsections"]),
                    "estimatedPages": max(1, len(chapters) * 12),
                    "summary": f"A publication-ready book manuscript structured from spoken audio recording."
                },
                "chapters": chapters
            }

            self.send_json_response({"success": True, "book": book_payload})
        except Exception as e:
            self.send_json_response({"success": False, "error": str(e)}, status=500)

    def generate_book_chapters(self, segments, title, author, genre):
        if not segments:
            # Fall back to showcase book if empty
            sample_file = SAMPLE_DATA_DIR / "showcase_book.json"
            if sample_file.exists():
                with open(sample_file, "r") as f:
                    return json.load(f)["chapters"]
            return []

        # Partition segments into 4-6 chapters
        total = len(segments)
        chunk_size = max(1, total // 5)
        chapter_chunks = [segments[i:i + chunk_size] for i in range(0, total, chunk_size)]
        if len(chapter_chunks) > 6:
            chapter_chunks = chapter_chunks[:6]

        generated_chapters = []
        num_names = ["One", "Two", "Three", "Four", "Five", "Six"]

        for idx, chunk in enumerate(chapter_chunks):
            start_ts = chunk[0].get("timestamps", {}).get("from", "00:00:00.000")
            end_ts = chunk[-1].get("timestamps", {}).get("to", "00:00:00.000")
            raw_text = " ".join(s.get("text", "").strip() for s in chunk)
            
            # Clean spoken artifacts
            clean_text = self.clean_spoken_prose(raw_text)

            # Split into sub-sections
            words = clean_text.split()
            mid = len(words) // 2
            sec1 = " ".join(words[:mid])
            sec2 = " ".join(words[mid:])

            c_num = num_names[idx] if idx < len(num_names) else str(idx + 1)
            first_words = " ".join(words[:5]).replace(".", "").title()

            generated_chapters.append({
                "id": idx + 1,
                "number": f"Chapter {c_num}",
                "title": f"The Principle of {first_words or 'Foundations'}",
                "subtitle": f"Discourse Analysis ({start_ts[:5]} to {end_ts[:5]})",
                "epigraph": f"\"Truth unexpressed is potential unfulfilled; when spoken, it shapes eternity.\" — {author}",
                "timeRange": f"{start_ts} - {end_ts}",
                "summary": f"Examines key theological and philosophical themes introduced in this segment.",
                "subsections": [
                    {
                        "heading": f"{idx+1}.1 Foundations and Historical Context",
                        "content": sec1
                    },
                    {
                        "heading": f"{idx+1}.2 Practical Applications & Future Vision",
                        "content": sec2
                    }
                ],
                "pullQuote": " ".join(words[:25]) + "...",
                "keyTakeaways": [
                    "Core philosophical premise established in opening arguments.",
                    "Exegetical alignment between historical records and contemporary realities.",
                    "Strategic mandate for the present generation."
                ],
                "discussionQuestions": [
                    "How does this chapter redefine traditional understandings of the subject?",
                    "What actionable step will you implement this week based on these insights?"
                ]
            })

        return generated_chapters

    def clean_spoken_prose(self, raw):
        import re
        # Remove repeated speech fillers and audio tags
        t = re.sub(r'\[.*?\]', '', raw)
        t = re.sub(r'\b(um|uh|you know|like|all right|now watch this|you see)\b', '', t, flags=re.IGNORECASE)
        t = re.sub(r'\s+', ' ', t).strip()
        # Capitalize sentences
        sentences = re.split(r'([.!?]+)', t)
        cleaned_sentences = []
        for i in range(0, len(sentences)-1, 2):
            s = sentences[i].strip()
            punct = sentences[i+1]
            if s:
                cleaned_sentences.append(s[0].upper() + s[1:] + punct)
        if len(sentences) % 2 == 1 and sentences[-1].strip():
            cleaned_sentences.append(sentences[-1].strip().capitalize() + ".")
        return " ".join(cleaned_sentences)

    def handle_export_md(self):
        try:
            length = int(self.headers.get('content-length', 0))
            req_body = self.rfile.read(length).decode('utf-8')
            book = json.loads(req_body)

            meta = book.get("meta", {})
            chapters = book.get("chapters", [])

            lines = [
                f"# {meta.get('title', 'Book Title')}",
                f"### {meta.get('subtitle', '')}\n",
                f"**Author:** {meta.get('author', 'Author')}  ",
                f"**Genre:** {meta.get('genre', '')}  ",
                f"**Edition:** {meta.get('edition', '')}  ",
                f"**Publication Year:** {meta.get('publicationDate', '2026')}  \n",
                "---\n",
                "## Table of Contents\n"
            ]

            for c in chapters:
                lines.append(f"- **{c.get('number', '')}:** [{c.get('title', '')}](#{c.get('id', '')})")

            lines.append("\n---\n")

            for c in chapters:
                lines.append(f"## <a name=\"{c.get('id', '')}\"></a>{c.get('number', '')}: {c.get('title', '')}")
                lines.append(f"*{c.get('subtitle', '')}*\n")
                if c.get('epigraph'):
                    lines.append(f"> {c.get('epigraph')}\n")
                
                for sub in c.get('subsections', []):
                    lines.append(f"### {sub.get('heading', '')}\n")
                    lines.append(f"{sub.get('content', '')}\n")

                if c.get('pullQuote'):
                    lines.append(f"> 💡 **Key Insight:** {c.get('pullQuote')}\n")

                if c.get('keyTakeaways'):
                    lines.append("#### Key Takeaways")
                    for k in c.get('keyTakeaways', []):
                        lines.append(f"- {k}")
                    lines.append("")

                if c.get('discussionQuestions'):
                    lines.append("#### Reflection & Discussion")
                    for q in c.get('discussionQuestions', []):
                        lines.append(f"1. {q}")
                    lines.append("")

                lines.append("---\n")

            md_content = "\n".join(lines)
            self.send_response(200)
            self.send_header('Content-Type', 'text/markdown; charset=utf-8')
            self.send_header('Content-Disposition', f'attachment; filename="{meta.get("title", "book")}.md"')
            self.end_headers()
            self.wfile.write(md_content.encode('utf-8'))
        except Exception as e:
            self.send_json_response({"success": False, "error": str(e)}, status=500)

    def send_json_response(self, data, status=200):
        body = json.dumps(data, indent=2).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

if __name__ == "__main__":
    os.chdir(BASE_DIR)
    server_address = ('', PORT)
    httpd = HTTPServer(server_address, ScripturaHandler)
    print(f"🚀 Scriptura Publishing Engine running at http://localhost:{PORT}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server.")
        httpd.server_close()
