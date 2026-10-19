import os
from core.app import app

if __name__ == "__main__":
    debug_mode = os.environ.get("FLASK_DEBUG", "false").lower() == "true"
    port = int(os.environ.get("PORT", 5000))
    host = os.environ.get("HOST", "0.0.0.0")

    if debug_mode:
        print("Default False")
    app.run(debug=debug_mode, host=host, port=port)