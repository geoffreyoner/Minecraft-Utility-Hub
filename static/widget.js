(function () {
  var script = document.currentScript;
  if (!script || typeof script.getAttribute !== "function") {
    var all = document.querySelectorAll('script[src*="widget.js"]');
    script = all[all.length - 1] || null;
  }

  var API = (script && script.getAttribute && script.getAttribute("data-api")) || "/api/chat";
  var TITLE = (script && script.getAttribute && script.getAttribute("data-title")) || "Asisten Goomys";
  var GREETING = (script && script.getAttribute && script.getAttribute("data-greeting")) ||
    "Selamat datang di Minecraft Utility Hub. Silakan tanya soal fitur website atau modpack.";

  // Delay minimum sebelum mulai nampilin jawaban (ms)
  var MIN_THINK_MS = 600;
  // Delay per karakter (ms) — bikin jawaban muncul bertahap walau upstream nge-burst
  var CHAR_DELAY_MS = 12;

  window.MUHChat = window.MUHChat || {
    open: function () {
      var tries = 0;
      var iv = setInterval(function () {
        if (window.MUHChat._ready) {
          clearInterval(iv);
          window.MUHChat._open();
        } else if (++tries > 30) {
          clearInterval(iv);
          console.error("[Goomys] UI gagal dibangun setelah 3 detik");
        }
      }, 100);
    },
    close: function () {}
  };

  function buildUI() {
    if (window.MUHChat._ready) return;

    var style = document.createElement("style");
    style.textContent = [
      '.muh-chat-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:999998;display:none;align-items:center;justify-content:center;padding:16px;opacity:0;transition:opacity .2s ease;}',
      '.muh-chat-backdrop.open{display:flex;opacity:1;}',
      '.muh-chat-panel{width:400px;max-width:100%;height:520px;max-height:calc(100dvh - 40px);background:#120d0a;border:1px solid rgba(255,255,255,.08);border-radius:16px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 60px -12px rgba(0,0,0,.85);opacity:0;transform:scale(.96) translateY(8px);transition:opacity .22s ease,transform .22s cubic-bezier(.16,1,.3,1);font-family:"Plus Jakarta Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}',
      '.muh-chat-panel *{box-sizing:border-box;}',
      '.muh-chat-backdrop.open .muh-chat-panel{opacity:1;transform:scale(1) translateY(0);}',
      '.muh-chat-head{background:linear-gradient(135deg,#f97316 0%,#f0a63a 50%,#f5b942 100%);color:#1a0f00;padding:14px 18px;display:flex;justify-content:space-between;align-items:center;font-weight:700;font-size:14px;flex-shrink:0;}',
      '.muh-chat-head-title{display:flex;align-items:center;gap:8px;}',
      '.muh-chat-dot{width:7px;height:7px;border-radius:50%;background:#1a0f00;animation:muhChatDot 2s ease-in-out infinite;}',
      '@keyframes muhChatDot{0%,100%{opacity:1;}50%{opacity:.4;}}',
      '.muh-chat-close{background:transparent;border:none;color:#1a0f00;font-size:22px;cursor:pointer;line-height:1;padding:0 4px;opacity:.75;transition:opacity .15s;}',
      '.muh-chat-close:hover{opacity:1;}',
      '.muh-chat-log{flex:1;overflow-y:auto;padding:16px;overscroll-behavior:contain;}',
      '.muh-chat-log::-webkit-scrollbar{width:6px;}',
      '.muh-chat-log::-webkit-scrollbar-thumb{background:rgba(249,115,22,.3);border-radius:3px;}',
      '.muh-chat-msg{padding:10px 14px;border-radius:14px;margin-bottom:10px;font-size:13.5px;line-height:1.55;max-width:85%;word-wrap:break-word;white-space:pre-wrap;opacity:0;transform:translateY(4px);animation:muhChatMsgIn .22s ease-out forwards;}',
      '@keyframes muhChatMsgIn{to{opacity:1;transform:translateY(0);}}',
      '.muh-chat-msg.user{background:linear-gradient(135deg,#f97316 0%,#f0a63a 100%);color:#1a0f00;font-weight:600;margin-left:auto;border-bottom-right-radius:4px;}',
      '.muh-chat-msg.bot{background:rgba(255,255,255,.04);color:#f7f2ea;border:1px solid rgba(255,255,255,.06);border-bottom-left-radius:4px;}',

      // Typing indicator: 3 dot animasi
      '.muh-chat-msg.bot.typing{padding:14px 18px;display:inline-flex;align-items:center;gap:5px;}',
      '.muh-chat-msg.bot.typing .t-dot{width:6px;height:6px;border-radius:50%;background:#f97316;display:inline-block;opacity:.4;animation:muhTypingBounce 1.3s ease-in-out infinite;}',
      '.muh-chat-msg.bot.typing .t-dot:nth-child(2){animation-delay:.18s;}',
      '.muh-chat-msg.bot.typing .t-dot:nth-child(3){animation-delay:.36s;}',
      '@keyframes muhTypingBounce{0%,60%,100%{transform:translateY(0);opacity:.4;}30%{transform:translateY(-4px);opacity:1;}}',

      '.muh-chat-msg.error{background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3);color:#fca5a5;}',
      '.muh-chat-suggest{display:flex;flex-wrap:wrap;gap:6px;padding:0 16px 10px 16px;flex-shrink:0;}',
      '.muh-chat-suggest button{background:rgba(249,115,22,.08);border:1px solid rgba(249,115,22,.25);color:#fb923c;font-size:11.5px;font-weight:600;padding:6px 12px;border-radius:999px;cursor:pointer;font-family:inherit;transition:background .18s,border-color .18s;}',
      '.muh-chat-suggest button:hover{background:rgba(249,115,22,.16);border-color:rgba(249,115,22,.5);}',
      '.muh-chat-suggest.hidden{display:none;}',
      '.muh-chat-form{display:flex;gap:8px;padding:12px;border-top:1px solid rgba(255,255,255,.06);background:rgba(10,8,7,.6);flex-shrink:0;}',
      '.muh-chat-input{flex:1;background:rgba(0,0,0,.4);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:11px 14px;color:#f7f2ea;font-size:16px;font-weight:500;outline:none;font-family:inherit;transition:border-color .18s,box-shadow .18s;min-width:0;}',
      '.muh-chat-input::placeholder{color:#8a7c6c;}',
      '.muh-chat-input:focus{border-color:rgba(249,115,22,.5);box-shadow:0 0 0 3px rgba(249,115,22,.1);}',
      '.muh-chat-send{background:linear-gradient(135deg,#f97316 0%,#f0a63a 50%,#f5b942 100%);color:#1a0f00;border:none;border-radius:12px;padding:0 18px;cursor:pointer;font-weight:700;font-size:13px;font-family:inherit;transition:transform .15s,opacity .15s;flex-shrink:0;}',
      '.muh-chat-send:hover:not(:disabled){transform:translateY(-1px);}',
      '.muh-chat-send:active:not(:disabled){transform:scale(.97);}',
      '.muh-chat-send:disabled{opacity:.45;cursor:not-allowed;}',
      '@media (max-width:480px){.muh-chat-backdrop{padding:12px;}.muh-chat-panel{width:100%;height:auto;max-height:70dvh;min-height:360px;}.muh-chat-msg{max-width:88%;font-size:13px;}}',
      '@media (prefers-reduced-motion:reduce){.muh-chat-backdrop,.muh-chat-panel,.muh-chat-msg,.muh-chat-dot,.muh-chat-msg.bot.typing .t-dot{animation-duration:.001ms !important;transition-duration:.001ms !important;}}'
    ].join("");
    document.head.appendChild(style);

    var backdrop = document.createElement("div");
    backdrop.className = "muh-chat-backdrop";
    backdrop.innerHTML =
      '<div class="muh-chat-panel">' +
        '<div class="muh-chat-head">' +
          '<div class="muh-chat-head-title">' +
            '<span class="muh-chat-dot"></span>' +
            '<span>' + TITLE + '</span>' +
          '</div>' +
          '<button class="muh-chat-close" aria-label="Tutup">&times;</button>' +
        '</div>' +
        '<div class="muh-chat-log"></div>' +
        '<div class="muh-chat-suggest">' +
          '<button data-q="Bagaimana cara pakai Player Inspector?">Cara pakai Player Inspector</button>' +
          '<button data-q="Modpack apa yang cocok untuk PC kentang?">Modpack PC kentang</button>' +
          '<button data-q="Mod loader apa saja yang didukung?">Loader yang didukung</button>' +
        '</div>' +
        '<form class="muh-chat-form">' +
          '<input class="muh-chat-input" placeholder="Tulis pesan..." autocomplete="off" inputmode="text" />' +
          '<button type="submit" class="muh-chat-send">Kirim</button>' +
        '</form>' +
      '</div>';
    document.body.appendChild(backdrop);

    var $ = function (s) { return backdrop.querySelector(s); };
    var log = $(".muh-chat-log");
    var input = $(".muh-chat-input");
    var form = $(".muh-chat-form");
    var sendBtn = $(".muh-chat-send");
    var suggest = $(".muh-chat-suggest");
    var history = [];
    var greeted = false;
    var openFlag = false;

    function addMsg(role, text, extraClass) {
      var el = document.createElement("div");
      el.className = ("muh-chat-msg " + role + " " + (extraClass || "")).trim();
      el.textContent = text || "";
      log.appendChild(el);
      log.scrollTop = log.scrollHeight;
      return el;
    }

    // Typing indicator: 3 dot animasi
    function addTypingIndicator() {
      var el = document.createElement("div");
      el.className = "muh-chat-msg bot typing";
      el.innerHTML = '<span class="t-dot"></span><span class="t-dot"></span><span class="t-dot"></span>';
      log.appendChild(el);
      log.scrollTop = log.scrollHeight;
      return el;
    }

    function openChat() {
      if (openFlag) return;
      openFlag = true;
      if (!greeted) {
        addMsg("bot", GREETING);
        greeted = true;
      }
      backdrop.style.display = "flex";
      void backdrop.offsetWidth;
      backdrop.classList.add("open");
    }

    function closeChat() {
      if (!openFlag) return;
      openFlag = false;
      backdrop.classList.remove("open");
      setTimeout(function () {
        if (!openFlag) backdrop.style.display = "none";
      }, 220);
    }

    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) closeChat();
    });
    $(".muh-chat-close").onclick = closeChat;
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && openFlag) closeChat();
    });

    suggest.querySelectorAll("button").forEach(function (btn) {
      btn.onclick = function () {
        input.value = btn.dataset.q;
        form.dispatchEvent(new Event("submit", { cancelable: true }));
      };
    });

    form.onsubmit = async function (e) {
      e.preventDefault();
      var text = input.value.trim();
      if (!text) return;

      input.value = "";
      addMsg("user", text);
      history.push({ role: "user", content: text });
      suggest.classList.add("hidden");

      // Tampilkan typing indicator dulu
      var typingEl = addTypingIndicator();
      sendBtn.disabled = true;

      var startedAt = performance.now();
      var botEl = null;
      var full = "";
      var queue = [];        // buffer karakter yang belum ditampilin
      var displayed = 0;     // index karakter yang udah ditampilin
      var streamDone = false;
      var typingRaf = null;
      var typingTick = null;

      // Render karakter dari queue pakai interval
      function startRenderLoop() {
        if (typingTick) return;
        typingTick = setInterval(function () {
          // Ambil dari queue sesuai kecepatan
          while (queue.length > 0) {
            var ch = queue.shift();
            full += ch;
            displayed++;
            if (botEl) botEl.textContent = full;
            log.scrollTop = log.scrollHeight;
            if (CHAR_DELAY_MS > 0) break; // 1 char per tick
          }
          // Kalau stream udah selesai & queue kosong, stop loop
          if (streamDone && queue.length === 0) {
            clearInterval(typingTick);
            typingTick = null;
            onStreamComplete();
          }
        }, Math.max(CHAR_DELAY_MS, 8));
      }

      // Ganti typing indicator jadi bubble bot kosong, begitu chunk pertama siap
      function prepareBotBubble() {
        if (botEl) return;
        if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
        botEl = document.createElement("div");
        botEl.className = "muh-chat-msg bot";
        log.appendChild(botEl);
      }

      function onStreamComplete() {
        if (!full) {
          if (!botEl) prepareBotBubble();
          botEl.textContent = "Maaf, saya tidak menerima jawaban. Silakan coba lagi.";
        }
        history.push({ role: "assistant", content: full });
        sendBtn.disabled = false;
      }

      try {
        var res = await fetch(API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history }),
        });
        if (!res.ok || !res.body) throw new Error("bad response");

        var reader = res.body.getReader();
        var dec = new TextDecoder();
        var buf = "";
        var firstChunkAt = null;

        while (true) {
          var chunk = await reader.read();
          if (chunk.done) break;
          buf += dec.decode(chunk.value, { stream: true });
          var lines = buf.split("\n");
          buf = lines.pop();

          for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (line.indexOf("data:") !== 0) continue;
            var payload = line.slice(5).trim();
            if (payload === "[DONE]") continue;
            try {
              var json = JSON.parse(payload);
              var delta = (json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content) || "";
              if (delta) {
                // Pas chunk pertama datang, tunggu minimal MIN_THINK_MS biar typing keliatan
                if (!firstChunkAt) {
                  firstChunkAt = performance.now();
                  var elapsed = firstChunkAt - startedAt;
                  var wait = Math.max(0, MIN_THINK_MS - elapsed);
                  if (wait > 0) {
                    await new Promise(function (r) { setTimeout(r, wait); });
                  }
                  prepareBotBubble();
                }
                // Push karakter ke queue
                for (var k = 0; k < delta.length; k++) {
                  queue.push(delta[k]);
                }
                startRenderLoop();
              }
            } catch (err) {}
          }
        }

        streamDone = true;
        if (!typingTick) {
          // Kalau stream cepet & queue langsung kosong
          onStreamComplete();
        }
      } catch (err) {
        if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
        if (!botEl) {
          botEl = document.createElement("div");
          botEl.className = "muh-chat-msg bot error";
          log.appendChild(botEl);
        } else {
          botEl.classList.add("error");
        }
        botEl.textContent = "Maaf, koneksi bermasalah. Silakan coba lagi.";
        sendBtn.disabled = false;
      }
    };

    window.MUHChat._open = openChat;
    window.MUHChat._close = closeChat;
    window.MUHChat._ready = true;
    window.MUHChat.open = openChat;
    window.MUHChat.close = closeChat;
    console.log("[Goomys] Widget siap");
  }

  if (document.body) {
    buildUI();
  } else {
    document.addEventListener("DOMContentLoaded", buildUI);
  }
})();