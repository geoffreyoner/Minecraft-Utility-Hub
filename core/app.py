import os
import re
import requests
from datetime import datetime, timezone
from urllib.parse import quote
from flask import Flask, send_from_directory, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

from .mod import mod_bp
from .player import player_bp
from .chat import chat_bp
from .ratelimit import client_ip, make_limiter

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC_DIR = os.path.join(BASE_DIR, 'static')
CONFIG_DIR = os.path.join(BASE_DIR, 'config')

app = Flask(__name__, static_folder=STATIC_DIR, static_url_path="")
CORS(
    app,
    origins=[
        "http://localhost:5000",
        "http://127.0.0.1:5000",
        "https://minecraft-utility-hub.vercel.app",
    ],
)

CF_SECRET_KEY = os.environ.get("CF_SECRET_KEY")
DISCORD_WEBHOOK_URL = os.environ.get("DISCORD_WEBHOOK_URL")

TURNSTILE_BYPASS = os.environ.get("TURNSTILE_BYPASS", "false").lower() == "true"

_feedback_ok = make_limiter(5, 600)


@app.before_request
def verify_turnstile():
    path = request.path
    needs_check = path.startswith("/api/track") or path == "/api/modpack/download"
    if not needs_check:
        return
    if request.method == "OPTIONS":
        return

    if TURNSTILE_BYPASS:
        return

    if not CF_SECRET_KEY:
        return jsonify({"error": "Server misconfigured: CF_SECRET_KEY belum di-set."}), 500

    token = request.headers.get("X-Turnstile-Token")
    if not token:
        return jsonify({"error": "Akses ditolak: Verifikasi keamanan (CAPTCHA) tidak ditemukan."}), 403

    try:
        res = requests.post(
            "https://challenges.cloudflare.com/turnstile/v0/siteverify",
            data={"secret": CF_SECRET_KEY, "response": token},
            timeout=5,
        )
        result = res.json()
        if not result.get("success"):
            return jsonify({"error": "Akses ditolak: Verifikasi keamanan gagal."}), 403
    except requests.RequestException:
        return jsonify({"error": "Gagal menghubungi server verifikasi Cloudflare."}), 502


@app.route('/api/feedback', methods=['POST'])
def send_feedback():
    if not _feedback_ok(client_ip(request)):
        return jsonify({"success": False, "error": "Terlalu banyak kirim masukan. Coba lagi nanti."}), 429

    data = request.json or {}
    username = str(data.get('username', 'Anonim')).strip()[:80] or 'Anonim'
    message = str(data.get('message', '')).strip()[:2000]

    if not message:
        return jsonify({"success": False, "error": "Pesan tidak boleh kosong"}), 400

    avatar_url = "https://minecraft-utility-hub.vercel.app/img/favicon.png"
    if re.match(r"^[a-zA-Z0-9_]{3,16}$", username):
        avatar_url = f"https://mc-heads.net/avatar/{quote(username)}/100"

    payload = {
        "username": "Minecraft Utility Hub - Feedback",
        "avatar_url": "https://minecraft-utility-hub.vercel.app/img/favicon.png",

        "embeds": [{
            "title": "Kritik & Saran Baru",
            "color": 3447003,
            "author": {
                "name": username,
                "icon_url": avatar_url,
            },
            "description": message,
            "footer": {
                "text": "Minecraft Utility Hub",
            },
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }],
    }

    if not DISCORD_WEBHOOK_URL:
        return jsonify({"success": False, "error": "Feedback belum dikonfigurasi."}), 500

    try:
        response = requests.post(DISCORD_WEBHOOK_URL, json=payload, timeout=5)
    except requests.RequestException:
        return jsonify({"success": False, "error": "Gagal menghubungi server Discord"}), 502

    if response.status_code in (200, 204):
        return jsonify({"success": True, "message": "Kritik & saran berhasil dikirim!"})

    return jsonify({"success": False, "error": "Gagal mengirim ke Discord"}), 500

app.register_blueprint(mod_bp)
app.register_blueprint(player_bp)
app.register_blueprint(chat_bp)


@app.route("/")
def index():
    return app.send_static_file("index.html")


@app.route("/lang.json")
def send_from_config():
    return send_from_directory(CONFIG_DIR, "lang.json")
