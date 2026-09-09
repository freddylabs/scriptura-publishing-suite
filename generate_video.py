import os
import sys
import json
import time
import urllib.request
import urllib.parse
from pathlib import Path

REPLICATE_API_TOKEN = os.environ.get("REPLICATE_API_TOKEN", "")
DOWNLOADS_DIR = Path.home() / "Downloads"

MODELS = {
    # Minimax Video-01 (Hailuo AI) - High quality realistic video
    "minimax": "minimax/video-01",
    # Luma Dream Machine (Ray)
    "luma": "luma/ray",
    # LTX Video - Fast and lightweight
    "ltx": "fofr/ltx-video",
    # Hunyuan Video
    "hunyuan": "zsxkib/hunyuan-video",
    # Kling v1.6 Standard
    "kling": "kwaivgi/kling-v1.6-standard"
}

def generate_video(prompt: str, model_alias: str = "minimax", filename_prefix: str = "ai_video", first_frame_image: str = None) -> str:
    model_name = MODELS.get(model_alias.lower(), model_alias)
    print(f"🎬 Initializing generation with model: {model_name}")
    print(f"📝 Prompt: \"{prompt}\"")
    
    url = f"https://api.replicate.com/v1/models/{model_name}/predictions"
    headers = {
        "Authorization": f"Bearer {REPLICATE_API_TOKEN}",
        "Content-Type": "application/json",
        "User-Agent": "AntigravityVideoClient/1.0"
    }
    
    input_data = {"prompt": prompt}
    if first_frame_image:
        input_data["first_frame_image"] = first_frame_image
        
    payload = json.dumps({"input": input_data}).encode("utf-8")
    req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
    
    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            pred_id = data["id"]
            get_url = data["urls"]["get"]
            print(f"🚀 Prediction created (ID: {pred_id}). Rendering...")
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8")
        print(f"❌ Error creating prediction: {e.code} - {err_body}")
        return None

    # Polling loop
    start_time = time.time()
    get_req = urllib.request.Request(get_url, headers=headers)
    
    while True:
        time.sleep(3)
        try:
            with urllib.request.urlopen(get_req) as resp:
                status_data = json.loads(resp.read().decode("utf-8"))
                status = status_data["status"]
                elapsed = int(time.time() - start_time)
                
                if status == "processing":
                    logs = status_data.get("logs", "")
                    last_log = logs.strip().split("\n")[-1] if logs else "Processing..."
                    print(f"⏳ [{elapsed}s] {last_log}")
                elif status == "succeeded":
                    output = status_data["output"]
                    video_url = output if isinstance(output, str) else (output[0] if isinstance(output, list) else str(output))
                    print(f"✅ Video generated in {elapsed}s!")
                    print(f"🔗 URL: {video_url}")
                    
                    # Download to Downloads folder
                    safe_title = "".join(c for c in prompt[:30] if c.isalnum() or c in " _-").strip().replace(" ", "_")
                    timestamp = time.strftime("%Y%m%d_%H%M%S")
                    out_filename = f"{filename_prefix}_{safe_title}_{timestamp}.mp4"
                    out_path = DOWNLOADS_DIR / out_filename
                    
                    print(f"⬇️ Downloading to {out_path}...")
                    urllib.request.urlretrieve(video_url, out_path)
                    print(f"🎉 Saved to: {out_path}")
                    return str(out_path)
                elif status in ["failed", "canceled"]:
                    error_msg = status_data.get("error", "Unknown error")
                    print(f"❌ Generation {status}: {error_msg}")
                    return None
        except Exception as e:
            print(f"⚠️ Polling check error: {e}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 generate_video.py <prompt> [model_alias: minimax|luma|ltx|hunyuan|kling]")
        sys.exit(1)
    
    prompt = sys.argv[1]
    model_choice = sys.argv[2] if len(sys.argv) > 2 else "minimax"
    generate_video(prompt, model_choice)
