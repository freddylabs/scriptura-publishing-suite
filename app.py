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
import uuid
import shutil
import subprocess
import re
from pathlib import Path
from http.server import HTTPServer, SimpleHTTPRequestHandler
from socketserver import ThreadingMixIn
import urllib.parse
import cgi

PORT = int(os.environ.get("PORT", 8080))
BASE_DIR = Path(__file__).parent.resolve()
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)
SESSIONS_DIR = UPLOAD_DIR / "sessions"
SESSIONS_DIR.mkdir(exist_ok=True)
CLIPS_DIR = UPLOAD_DIR / "clips"
CLIPS_DIR.mkdir(exist_ok=True)
SAMPLE_DATA_DIR = BASE_DIR / "sample_data"
MAX_UPLOAD_BYTES = 1024 * 1024 * 1024
MAX_MULTIPART_OVERHEAD = 4 * 1024 * 1024
SESSION_TTL_SEC = 4 * 60 * 60
SESSION_ID_RE = re.compile(r"^[0-9a-fA-F-]{36}$")
SCRATCH_DIR = Path("/Users/farthu1/.gemini/antigravity-ide/brain/88273a8b-e281-4611-a26c-7a8897db5f4b/scratch")
WHISPER_BIN = SCRATCH_DIR / "whisper.cpp" / "main"
WHISPER_MODEL = SCRATCH_DIR / "whisper.cpp" / "models" / "ggml-base.en.bin"

class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def valid_session_id(value):
    return bool(value and SESSION_ID_RE.match(str(value)))


def session_path(session_id):
    return SESSIONS_DIR / session_id


def path_is_inside(child, parent):
    try:
        Path(child).resolve().relative_to(Path(parent).resolve())
        return True
    except (ValueError, OSError):
        return False


def touch_session(session_id):
    folder = session_path(session_id)
    folder.mkdir(parents=True, exist_ok=True)
    stamp = folder / ".activity"
    stamp.write_text(str(time.time()), encoding="utf-8")
    return folder


def purge_session(session_id):
    folder = session_path(session_id)
    if folder.exists() and path_is_inside(folder, SESSIONS_DIR):
        shutil.rmtree(folder, ignore_errors=True)


def expire_old_sessions():
    now = time.time()
    if not SESSIONS_DIR.exists():
        return
    for folder in SESSIONS_DIR.iterdir():
        if not folder.is_dir():
            continue
        stamp = folder / ".activity"
        try:
            mtime = stamp.stat().st_mtime if stamp.exists() else folder.stat().st_mtime
        except OSError:
            continue
        if now - mtime > SESSION_TTL_SEC:
            shutil.rmtree(folder, ignore_errors=True)


class ScripturaHandler(SimpleHTTPRequestHandler):
    timeout = None
    protocol_version = "HTTP/1.1"

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Session-Id')
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

        if path == "/api/discard":
            self.handle_discard()
            return

        if path == "/api/export-md":
            self.handle_export_md()
            return

        self.send_error(404, "Endpoint not found")

    def handle_upload(self):
        try:
            expire_old_sessions()
            content_length = int(self.headers.get("content-length", 0) or 0)
            if content_length > MAX_UPLOAD_BYTES + MAX_MULTIPART_OVERHEAD:
                self.close_connection = True
                self.send_json_response({
                    "success": False,
                    "error": "File is over 1 GB. Please upload a smaller recording."
                }, status=413)
                return

            ctype, _pdict = cgi.parse_header(self.headers.get("content-type", ""))
            if ctype != "multipart/form-data":
                self.send_error(400, "Expected multipart/form-data")
                return

            environ = {
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": self.headers.get("Content-Type", ""),
                "CONTENT_LENGTH": str(content_length),
            }
            form = cgi.FieldStorage(
                fp=self.rfile,
                headers=self.headers,
                environ=environ,
                keep_blank_values=True,
            )

            item = form["file"] if "file" in form else None
            if item is None or not getattr(item, "file", None):
                self.send_error(400, "No file uploaded")
                return

            original_filename = form.getvalue("filename") or getattr(item, "filename", None) or "uploaded_media.mp4"
            safe_name = "".join(c for c in original_filename if c.isalnum() or c in "._- ") or "uploaded_media.mp4"

            session_id = form.getvalue("sessionId") or self.headers.get("X-Session-Id") or str(uuid.uuid4())
            if not valid_session_id(session_id):
                session_id = str(uuid.uuid4())

            folder = touch_session(session_id)
            (folder / "clips").mkdir(exist_ok=True)
            save_path = folder / safe_name

            written = 0
            with open(save_path, "wb") as out:
                while True:
                    chunk = item.file.read(1024 * 1024)
                    if not chunk:
                        break
                    written += len(chunk)
                    if written > MAX_UPLOAD_BYTES:
                        out.close()
                        save_path.unlink(missing_ok=True)
                        self.send_json_response({
                            "success": False,
                            "error": "File is over 1 GB. Please upload a smaller recording."
                        }, status=413)
                        return
                    out.write(chunk)

            duration = 0
            try:
                proc = subprocess.run(["afinfo", str(save_path)], capture_output=True, text=True)
                for line in proc.stdout.split("\n"):
                    if "estimated duration" in line.lower():
                        duration = float(line.split(":")[1].replace("sec", "").strip())
            except Exception:
                pass

            rel = save_path.relative_to(UPLOAD_DIR).as_posix()
            self.send_json_response({
                "success": True,
                "filename": safe_name,
                "filePath": str(save_path),
                "sessionId": session_id,
                "sizeBytes": written,
                "maxBytes": MAX_UPLOAD_BYTES,
                "durationSec": duration,
                "webUrl": f"/uploads/{rel}",
                "expiresInSec": SESSION_TTL_SEC
            })
        except Exception as e:
            self.send_json_response({"success": False, "error": str(e)}, status=500)

    def handle_discard(self):
        try:
            expire_old_sessions()
            length = int(self.headers.get("content-length", 0) or 0)
            req_body = self.rfile.read(length).decode("utf-8") if length else "{}"
            params = json.loads(req_body) if req_body else {}
            session_id = params.get("sessionId") or self.headers.get("X-Session-Id")
            if not valid_session_id(session_id):
                self.send_json_response({"success": False, "error": "Missing session"}, status=400)
                return
            purge_session(session_id)
            self.send_json_response({"success": True, "discarded": True})
        except Exception as e:
            self.send_json_response({"success": False, "error": str(e)}, status=500)

    def handle_transcribe(self):
        try:
            length = int(self.headers.get('content-length', 0))
            req_body = self.rfile.read(length).decode('utf-8')
            params = json.loads(req_body) if req_body else {}

            input_path = params.get("filePath")
            session_id = params.get("sessionId")
            if valid_session_id(session_id):
                touch_session(session_id)

            if not input_path or not Path(input_path).exists() or not path_is_inside(input_path, UPLOAD_DIR):
                self.send_json_response({
                    "success": False,
                    "error": "Upload a recording first. The previous transcript is not reused."
                }, status=400)
                return

            work_dir = session_path(session_id) if valid_session_id(session_id) else UPLOAD_DIR
            work_dir.mkdir(parents=True, exist_ok=True)
            temp_wav = work_dir / f"temp_{int(time.time())}.wav"
            subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", input_path, str(temp_wav)], check=True)

            out_prefix = work_dir / f"transcript_{int(time.time())}"
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
                try:
                    temp_wav.unlink(missing_ok=True)
                except Exception:
                    pass
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
            session_id = params.get("sessionId")
            start = float(params.get("startSec", 0) or 0)
            end = float(params.get("endSec", 0) or 0)
            duration = max(0.4, end - start)

            if valid_session_id(session_id):
                touch_session(session_id)

            if not source or not Path(source).exists() or not path_is_inside(source, UPLOAD_DIR):
                self.send_json_response({
                    "success": False,
                    "error": "No source video on the server",
                    "fallback": "client"
                }, status=400)
                return

            stamp = int(time.time())
            out_name = f"clip_{stamp}_{int(start)}-{int(end)}.mp4"
            if valid_session_id(session_id):
                clips_dir = session_path(session_id) / "clips"
                clips_dir.mkdir(parents=True, exist_ok=True)
                out_path = clips_dir / out_name
                clip_url = f"/uploads/sessions/{session_id}/clips/{out_name}"
            else:
                out_path = CLIPS_DIR / out_name
                clip_url = f"/uploads/clips/{out_name}"

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
                    "clipUrl": clip_url,
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
    httpd = ThreadedHTTPServer(server_address, ScripturaHandler)
    print(f"Studio running at http://localhost:{PORT} (uploads up to 1 GB, deleted when you finish or after 4 hours)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server.")
        httpd.server_close()
