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
CLIPS_DIR = UPLOAD_DIR / "clips"
CLIPS_DIR.mkdir(exist_ok=True)
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

        if path == "/api/proofread":
            self.handle_proofread()
            return

        if path == "/api/crop-clip":
            self.handle_crop_clip()
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
                    "summary": "A readable draft taken from spoken language, with fillers removed and sentences repaired."
                },
                "chapters": chapters
            }

            self.send_json_response({"success": True, "book": book_payload})
        except Exception as e:
            self.send_json_response({"success": False, "error": str(e)}, status=500)

    def generate_book_chapters(self, segments, title, author, genre):
        import re
        if not segments:
            sample_file = SAMPLE_DATA_DIR / "showcase_book.json"
            if sample_file.exists():
                with open(sample_file, "r") as f:
                    return json.load(f)["chapters"]
            return []

        total = len(segments)
        groups = min(5, max(3, round(total / 160) or 3))
        chunk_size = max(1, (total + groups - 1) // groups)
        chapter_chunks = [segments[i:i + chunk_size] for i in range(0, total, chunk_size)]
        chapter_chunks = chapter_chunks[:6]

        generated_chapters = []
        num_names = ["One", "Two", "Three", "Four", "Five", "Six"]

        for idx, chunk in enumerate(chapter_chunks):
            start_ts = chunk[0].get("timestamps", {}).get("from", "00:00:00.000")
            end_ts = chunk[-1].get("timestamps", {}).get("to", "00:00:00.000")
            raw_text = " ".join(s.get("text", "").strip() for s in chunk)
            clean_text = self.clean_spoken_prose(raw_text)
            paragraphs = self.to_paragraphs(clean_text)

            mid = max(1, (len(paragraphs) + 1) // 2)
            first = "\n\n".join(paragraphs[:mid])
            second = "\n\n".join(paragraphs[mid:])
            c_num = num_names[idx] if idx < len(num_names) else str(idx + 1)

            generated_chapters.append({
                "id": idx + 1,
                "number": f"Chapter {c_num}",
                "title": self.pick_chapter_title(clean_text, c_num),
                "subtitle": f"{start_ts[:8]} – {end_ts[:8]}",
                "epigraph": "",
                "timeRange": f"{start_ts} - {end_ts}",
                "summary": "",
                "subsections": (
                    [{"heading": "", "content": first}]
                    + ([{"heading": "", "content": second}] if second else [])
                ),
                "pullQuote": self.pick_pull_quote(clean_text),
                "keyTakeaways": self.pick_takeaways(clean_text),
                "discussionQuestions": []
            })

        return generated_chapters

    def clean_spoken_prose(self, raw):
        import re
        t = re.sub(r'\[.*?\]', '', raw or "")
        t = re.sub(r'\((applause|laughter|music|inaudible|pause)\)', '', t, flags=re.IGNORECASE)
        t = re.sub(
            r'\b(um+|uh+|er+|ah+|hmm+|you know|i mean|kind of|sort of|all right|now watch this)\b',
            '',
            t,
            flags=re.IGNORECASE,
        )
        t = re.sub(r'\bgonna\b', 'going to', t, flags=re.IGNORECASE)
        t = re.sub(r'\bwanna\b', 'want to', t, flags=re.IGNORECASE)
        t = re.sub(r'\bgotta\b', 'have to', t, flags=re.IGNORECASE)
        t = re.sub(r"\blets\b", "let's", t, flags=re.IGNORECASE)
        t = re.sub(r'\bafrica\b', 'Africa', t, flags=re.IGNORECASE)
        t = re.sub(r'\bgod\b', 'God', t)
        t = re.sub(r'\b(\w+)\s+\1\b', r'\1', t, flags=re.IGNORECASE)
        t = re.sub(r'\s+([,.;:!?])', r'\1', t)
        t = re.sub(r',([.!?])', r'\1', t)
        t = re.sub(r'([.!?]){2,}', r'\1', t)
        t = re.sub(r'\s+', ' ', t).strip()

        sentences = re.split(r'([.!?]+)', t)
        cleaned_sentences = []
        for i in range(0, len(sentences) - 1, 2):
            s = sentences[i].strip()
            punct = sentences[i + 1]
            if s:
                cleaned_sentences.append(s[0].upper() + s[1:] + punct)
        if len(sentences) % 2 == 1 and sentences[-1].strip():
            leftover = sentences[-1].strip()
            cleaned_sentences.append(leftover[0].upper() + leftover[1:] + ".")
        return " ".join(cleaned_sentences)

    def to_paragraphs(self, text):
        import re
        sentences = re.findall(r'[^.!?]+[.!?]+|[^.!?]+$', text)
        paras = []
        bucket = []
        for s in sentences:
            s = s.strip()
            if not s:
                continue
            bucket.append(s)
            if len(bucket) >= 3:
                paras.append(" ".join(bucket))
                bucket = []
        if bucket:
            paras.append(" ".join(bucket))
        return paras or [text]

    def pick_chapter_title(self, text, fallback):
        import re
        sentences = re.findall(r'[^.!?]+[.!?]+', text)
        skip = re.compile(r'^(and|so|but|now|well|okay|yes|because|then)\b', re.I)
        for s in sentences[:10]:
            words = re.sub(r'["“”]', '', s).rstrip('.!?').split()
            if 5 <= len(words) <= 12 and not skip.search(s.strip()):
                return " ".join(words[:8]).rstrip(" ,;:")
        return f"Chapter {fallback}"

    def pick_pull_quote(self, text):
        import re
        sentences = [s.strip() for s in re.findall(r'[^.!?]+[.!?]+', text)]
        for s in sentences:
            if 40 < len(s) < 180 and re.search(r'never|not|god|africa|you are|truth|word', s, re.I):
                return s.strip(' "“”')
        return sentences[0].strip(' "“”') if sentences else ""

    def pick_takeaways(self, text):
        import re
        sentences = [s.strip() for s in re.findall(r'[^.!?]+[.!?]+', text)]
        picks = [s for s in sentences if 28 < len(s) < 140][:3]
        return picks

    def handle_proofread(self):
        try:
            length = int(self.headers.get('content-length', 0))
            req_body = self.rfile.read(length).decode('utf-8')
            params = json.loads(req_body) if req_body else {}
            text = params.get("text", "")
            cleaned = self.clean_spoken_prose(text)
            self.send_json_response({"success": True, "text": cleaned})
        except Exception as e:
            self.send_json_response({"success": False, "error": str(e)}, status=500)

    def handle_crop_clip(self):
        try:
            length = int(self.headers.get('content-length', 0))
            req_body = self.rfile.read(length).decode('utf-8')
            params = json.loads(req_body) if req_body else {}

            source = params.get("filePath")
            start = float(params.get("startSec", 0) or 0)
            end = float(params.get("endSec", 0) or 0)
            duration = max(0.4, end - start)

            if not source or not Path(source).exists():
                self.send_json_response({
                    "success": False,
                    "error": "No source video on the server",
                    "fallback": "client"
                }, status=400)
                return

            stamp = int(time.time())
            out_name = f"clip_{stamp}_{int(start)}-{int(end)}.mp4"
            out_path = CLIPS_DIR / out_name

            avconvert = shutil.which("avconvert") or "/usr/bin/avconvert"
            ffmpeg = shutil.which("ffmpeg")

            ok = False
            if Path(avconvert).exists():
                for preset in ("PresetPassthrough", "PresetMediumQuality"):
                    cmd = [
                        avconvert,
                        "--source", str(source),
                        "--output", str(out_path),
                        "--preset", preset,
                        "--start", f"{start:.3f}",
                        "--duration", f"{duration:.3f}",
                        "--replace",
                    ]
                    proc = subprocess.run(cmd, capture_output=True, text=True)
                    if proc.returncode == 0 and out_path.exists() and out_path.stat().st_size > 0:
                        ok = True
                        break

            if not ok and ffmpeg:
                cmd = [
                    ffmpeg, "-y",
                    "-ss", f"{start:.3f}",
                    "-to", f"{end:.3f}",
                    "-i", str(source),
                    "-c", "copy",
                    str(out_path),
                ]
                proc = subprocess.run(cmd, capture_output=True, text=True)
                ok = proc.returncode == 0 and out_path.exists() and out_path.stat().st_size > 0
                if not ok:
                    cmd = [
                        ffmpeg, "-y",
                        "-ss", f"{start:.3f}",
                        "-i", str(source),
                        "-t", f"{duration:.3f}",
                        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                        "-c:a", "aac",
                        str(out_path),
                    ]
                    proc = subprocess.run(cmd, capture_output=True, text=True)
                    ok = proc.returncode == 0 and out_path.exists() and out_path.stat().st_size > 0

            if ok:
                self.send_json_response({
                    "success": True,
                    "clipUrl": f"/uploads/clips/{out_name}",
                    "filename": out_name,
                    "startSec": start,
                    "endSec": end,
                    "durationSec": duration
                })
                return

            self.send_json_response({
                "success": False,
                "error": "Could not crop on the server",
                "fallback": "client"
            }, status=500)
        except Exception as e:
            self.send_json_response({"success": False, "error": str(e), "fallback": "client"}, status=500)

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
