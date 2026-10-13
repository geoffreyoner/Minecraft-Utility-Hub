import os
import json
import time
import logging
import requests
from collections import defaultdict
from flask import Blueprint, Response, request, stream_with_context

chat_bp = Blueprint('chat_bp', __name__)

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")

SYSTEM_PROMPT = """
Kamu adalah Asisten Goomys, asisten resmi website Minecraft Utility Hub.

GAYA BICARA:
- Formal tapi santai. Seperti customer service manusia yang ramah dan profesional, bukan robot.
- Pakai "saya" untuk diri sendiri, "kamu" atau "Anda" untuk user.
- Hindari pembukaan klise seperti "Halo! Selamat datang!" atau "Ada yang bisa saya bantu?" di setiap balasan. Langsung ke inti jawaban.
- Hindari penutup berlebihan seperti "Semoga membantu!" atau "Selamat beraktivitas!".
- Boleh pakai variasi pembuka yang wajar, contoh: "Untuk cek profil player, kamu bisa...", "Modpack PC kentang ada di preset...", "Saya belum punya info soal itu."
- Jangan pakai emoji sama sekali.
- Jangan pakai markdown (**, ##, -, `, dll). Tulis teks polos.
- Jawab ringkas, maksimal 3 kalimat. Kalau perlu lebih, bagi jadi poin yang jelas.

FITUR WEBSITE:
1. Player Inspector - cek profil Minecraft Java, render skin 3D, agregasi PvP tier dari MCTiers dan MCPVP Club.
2. ModVault - preset modpack siap unduh. Ada 8 preset: Extreme FPS Boost, Hardcore PvP, Survival Vanilla+, Builder & Shader, Content Creator, Technical & Redstone, RPG & Exploration, Bedwars & Minigames. Pilih preset, isi versi Minecraft dan loader (Fabric, Forge, NeoForge, Quilt), lalu unduh file .zip.
3. Kritik & Saran - form di footer buat kirim masukan.
4. Donasi - via Saweria, link ada di footer.

ATURAN:
1. Hanya jawab pertanyaan seputar Minecraft Utility Hub dan topik Minecraft yang berkaitan (mod, loader, versi, skin, PvP tier).
2. Kalau pertanyaan di luar topik, jawab persis: "Maaf, saya cuma bisa bantu seputar Minecraft Utility Hub."
3. Jangan bahas topik sensitif, SARA, pornografi, kekerasan, atau politik.
4. Jangan mengaku sebagai AI lain. Kamu adalah Asisten Goomys.
5. Gunakan bahasa yang sama dengan user (Indonesia atau Inggris).
6. Kalau tidak yakin, arahkan user ke fitur website atau form Kritik & Saran.
"""

BANNED = [
    'politik', 'presiden', 'pilpres', 'pilkada', 'partai', 'pemilu',
    'agama', 'islam', 'kristen', 'hindu', 'buddha', 'yahudi',
    'bokep', 'porno', 'sex', 'telanjang',
    'judi', 'slot', 'togel', 'sara', 'rasisme',
]

# --- Rate limit sederhana (in-memory) ---
_rate = defaultdict(list)
RATE_LIMIT = 20
RATE_WINDOW = 60


def _rate_ok(ip: str) -> bool:
    now = time.time()
    bucket = _rate[ip]
    bucket[:] = [t for t in bucket if now - t < RATE_WINDOW]
    if len(bucket) >= RATE_LIMIT:
        return False
    bucket.append(now)
    return True


def _sse_chunk(text: str) -> str:
    return f'data: {json.dumps({"choices": [{"delta": {"content": text}}]}, ensure_ascii=False)}\n\n'


def _stream_fallback(text: str) -> Response:
    def gen():
        yield _sse_chunk(text)
        yield 'data: [DONE]\n\n'
    return Response(
        stream_with_context(gen()),
        content_type='text/event-stream; charset=utf-8',
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@chat_bp.route("/api/chat", methods=["POST", "OPTIONS"])
def chat():
    if request.method == "OPTIONS":
        return ("", 204)

    ip = (request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
          or request.remote_addr or "unknown")
    if not _rate_ok(ip):
        return _stream_fallback("Terlalu banyak pertanyaan. Coba lagi sebentar.")

    if not GEMINI_API_KEY:
        return _stream_fallback("Maaf, layanan asisten sedang tidak tersedia.")

    data = request.get_json(silent=True) or {}
    messages = data.get("messages", [])
    if not messages:
        return _stream_fallback("Maaf, pesan kosong.")

    last = (messages[-1].get("content") or "").lower()
    if any(w in last for w in BANNED):
        return _stream_fallback("Maaf, saya cuma bisa bantu seputar Minecraft Utility Hub.")

    contents = []
    for m in messages[-10:]:
        role = "model" if m.get("role") == "assistant" else "user"
        contents.append({"role": role, "parts": [{"text": m.get("content", "")}]})

    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{GEMINI_MODEL}:streamGenerateContent?alt=sse"
    )
    headers = {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY,
    }
    payload = {
        "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": contents,
        "generationConfig": {"temperature": 0.4},
    }

    def generate():
        try:
            with requests.post(url, headers=headers, json=payload,
                               stream=True, timeout=30) as r:
                if r.status_code != 200:
                    logging.error(f"Gemini error {r.status_code}: {r.text[:300]}")
                    yield _sse_chunk("Maaf, server asisten lagi sibuk. Coba lagi nanti.")
                    yield 'data: [DONE]\n\n'
                    return

                for raw in r.iter_lines(decode_unicode=True):
                    if not raw:
                        continue
                    line = raw.strip()
                    if not line.startswith("data:"):
                        continue
                    body = line[5:].strip()
                    if not body:
                        continue
                    try:
                        j = json.loads(body)
                    except json.JSONDecodeError:
                        continue
                    try:
                        parts = j["candidates"][0]["content"]["parts"]
                        text = "".join(p.get("text", "") for p in parts)
                    except (KeyError, IndexError, TypeError):
                        text = ""
                    if text:
                        yield _sse_chunk(text)

                yield 'data: [DONE]\n\n'
        except Exception as e:
            logging.error(f"Chat stream error: {e}")
            yield _sse_chunk("Maaf, koneksi ke server bermasalah.")
            yield 'data: [DONE]\n\n'

    return Response(
        stream_with_context(generate()),
        content_type='text/event-stream; charset=utf-8',
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )