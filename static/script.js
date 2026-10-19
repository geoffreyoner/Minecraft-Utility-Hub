const FALLBACK_ICON = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
    '<rect x="3" y="3" width="18" height="18" rx="4" fill="none" stroke="#f97316" stroke-width="2"/>' +
    '<path d="M12 8v8M8 12h8" stroke="#f97316" stroke-width="2" stroke-linecap="round"/>' +
    '</svg>'
);

let currentTranslations = {};
let isSearching = false;

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function safeUrl(url) {
    if (!url) return FALLBACK_ICON;
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:image/')) return escapeHtml(url);
    return FALLBACK_ICON;
}

// Buka chat AI dengan retry — widget.js mungkin belum siap saat tombol diklik
function openMuhChat() {
    if (window.MUHChat && typeof window.MUHChat.open === 'function') {
        window.MUHChat.open();
        return;
    }
    let tries = 0;
    const iv = setInterval(() => {
        if (window.MUHChat && typeof window.MUHChat.open === 'function') {
            clearInterval(iv);
            window.MUHChat.open();
        } else if (++tries > 30) {
            clearInterval(iv);
            alert('Chat AI belum siap. Refresh halaman lalu coba lagi.');
        }
    }, 100);
}
window.openMuhChat = openMuhChat;

// Terjemahan
async function loadTranslations() {
    try {
        const response = await fetch('lang.json');
        currentTranslations = await response.json();
        const savedLang = localStorage.getItem('preferred_lang') || 'id';
        changeLanguage(savedLang);
    } catch (err) {
        console.warn('Gagal memuat lang.json:', err);
    }
}

function changeLanguage(lang) {
    localStorage.setItem('preferred_lang', lang);
    document.documentElement.lang = lang;

    const btnId = document.getElementById('langIdBtn');
    const btnEn = document.getElementById('langEnBtn');
    if (btnId) {
        btnId.classList.toggle('active', lang === 'id');
        btnId.setAttribute('aria-pressed', String(lang === 'id'));
    }
    if (btnEn) {
        btnEn.classList.toggle('active', lang === 'en');
        btnEn.setAttribute('aria-pressed', String(lang === 'en'));
    }

    renderPresetGrid();

    if (!currentTranslations[lang]) return;

    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (currentTranslations[lang][key]) {
            el.textContent = currentTranslations[lang][key];
        }
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (currentTranslations[lang][key]) {
            el.placeholder = currentTranslations[lang][key];
        }
    });
}

// Screen navigation + back button
let currentScreen = 'welcomeScreen';
const SCREEN_TITLES = {
    welcomeScreen: 'Minecraft Utility Hub',
    loginScreen: 'Player Inspector — Goomys',
    modpackScreen: 'ModVault — Goomys',
    dashboardScreen: 'Player Dashboard — Goomys'
};

function applyScreen(screenId) {
    document.querySelectorAll('.app-screen').forEach(screen => screen.classList.add('hidden'));
    const targetScreen = document.getElementById(screenId);
    if (targetScreen) targetScreen.classList.remove('hidden');
    if (screenId === 'dashboardScreen') requestAnimationFrame(resizeSkinViewer);

    document.title = SCREEN_TITLES[screenId] || 'Minecraft Utility Hub';
    currentScreen = screenId;
    window.scrollTo(0, 0);

    // Highlight nav item yang aktif
    document.querySelectorAll('.muh-nav-item[data-nav]').forEach(el => {
        el.classList.toggle('active', el.getAttribute('data-nav') === screenId);
    });
}

function switchScreen(screenId) {
    if (screenId === currentScreen) return;
    history.pushState({ screen: screenId }, '', '#' + screenId);
    applyScreen(screenId);
}

window.addEventListener('popstate', (e) => {
    const targetScreen = (e.state && e.state.screen) || 'welcomeScreen';
    if (targetScreen === currentScreen) return;
    applyScreen(targetScreen);
});

history.replaceState({ screen: 'welcomeScreen' }, '', location.pathname);

// Skin viewer 3D
let skinViewer = null;
let autoRotateActive = false;

function resizeSkinViewer() {
    const box = document.querySelector('.render-box');
    const canvas = document.getElementById('skinCanvas');
    if (!skinViewer || !box || !canvas) return;
    const w = box.clientWidth;
    const h = box.clientHeight;
    if (w > 0 && h > 0) {
        skinViewer.width = w;
        skinViewer.height = h;
    }
}

function initSkinViewer() {
    const canvas = document.getElementById('skinCanvas');
    if (!canvas || typeof skinview3d === 'undefined') return;
    const box = document.querySelector('.render-box');
    const width = (box && box.clientWidth) || 280;
    const height = (box && box.clientHeight) || 300;
    try {
        skinViewer = new skinview3d.SkinViewer({
            canvas: canvas,
            width: width,
            height: height,
            skin: 'https://crafatar.com/skins/8667ba71-b85a-4004-af54-457a9734eed7'
        });
        skinViewer.zoom = 0.85;
        skinViewer.controls.enableZoom = true;
        skinViewer.controls.enableRotate = true;
        skinViewer.controls.enablePan = false;
        skinViewer.controls.minDistance = 10;
        skinViewer.controls.maxDistance = 100;
        skinViewer.autoRotate = false;
        skinViewer.autoRotateSpeed = 1.4;
    } catch (err) {
        console.warn('Gagal init skinview3d:', err);
    }
    window.addEventListener('resize', resizeSkinViewer);
    window.addEventListener('orientationchange', () => setTimeout(resizeSkinViewer, 250));
}

function loadPlayerSkin(uuid) {
    if (!skinViewer) return;
    const skinUrl = `https://crafatar.com/skins/${escapeHtml(uuid)}`;
    try {
        skinViewer.loadSkin(skinUrl).catch(() => {
            skinViewer.loadSkin('https://crafatar.com/skins/8667ba71-b85a-4004-af54-457a9734eed7').catch(() => {});
        });
    } catch (err) {}
}

const autoRotateBtn = document.getElementById('autoRotateBtn');
if (autoRotateBtn) {
    autoRotateBtn.addEventListener('click', () => {
        autoRotateActive = !autoRotateActive;
        if (skinViewer) skinViewer.autoRotate = autoRotateActive;
        autoRotateBtn.classList.toggle('active', autoRotateActive);
    });
}

const resetViewBtn = document.getElementById('resetViewBtn');
if (resetViewBtn) {
    resetViewBtn.addEventListener('click', () => {
        if (!skinViewer) return;
        if (autoRotateActive) {
            autoRotateActive = false;
            skinViewer.autoRotate = false;
            if (autoRotateBtn) autoRotateBtn.classList.remove('active');
        }
        if (skinViewer.controls) {
            skinViewer.controls.target.set(0, 0, 0);
            skinViewer.camera.position.set(0, 0, 40);
            skinViewer.controls.update();
        }
        skinViewer.zoom = 0.85;
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initSkinViewer();
    loadTranslations();
    loadModpackPresets();
});

// Tier toggle
const tierToggle = document.getElementById('tierToggle');
const tierProviders = document.getElementById('tierProviders');

function applyTierVisibility() {
    if (tierProviders && tierToggle) {
        tierProviders.classList.toggle('collapsed', !tierToggle.checked);
    }
}

const savedTierPref = localStorage.getItem('showTierRankings_v3');
if (savedTierPref !== null && tierToggle) {
    tierToggle.checked = savedTierPref === 'true';
} else if (tierToggle) {
    tierToggle.checked = false;
}
applyTierVisibility();

if (tierToggle) {
    tierToggle.addEventListener('change', () => {
        localStorage.setItem('showTierRankings_v3', tierToggle.checked);
        applyTierVisibility();
    });
}

// Copy UUID
const uuidBtn = document.getElementById('playerUuid');
const uuidTextEl = document.getElementById('uuidText');
if (uuidBtn && uuidTextEl) {
    uuidBtn.addEventListener('click', function () {
        const fullText = uuidTextEl.textContent;
        if (fullText.includes('--')) return;
        const uuidText = fullText.replace('UUID: ', '').trim();
        navigator.clipboard.writeText(uuidText).then(() => {
            const originalText = uuidTextEl.textContent;
            uuidTextEl.textContent = 'Copied to Clipboard';
            uuidBtn.classList.add('copied');
            setTimeout(() => {
                uuidTextEl.textContent = originalText;
                uuidBtn.classList.remove('copied');
            }, 1600);
        }).catch(() => alert('Gagal menyalin. Izin clipboard ditolak.'));
    });
}

// Warna tier
function getTierColor(rank) {
    const r = rank.toUpperCase();
    if (r.includes('HT1')) return '#ffd166';
    if (r.includes('HT2')) return '#f5b942';
    if (r.includes('HT3')) return '#e8a53a';
    if (r.includes('HT4') || r.includes('HT5')) return '#d97706';
    if (r.includes('LT1')) return '#fb923c';
    if (r.includes('LT2')) return '#f97316';
    if (r.includes('LT3')) return '#ea580c';
    if (r.includes('LT4') || r.includes('LT5')) return '#c2410c';
    return '#f97316';
}

// Cari player
async function handleLoginAndSearch() {
    if (isSearching) return;
    const usernameInput = document.getElementById('usernameInput');
    const loginStatus = document.getElementById('loginStatus');
    if (!usernameInput) return;
    const username = usernameInput.value.trim();
    const currentLang = localStorage.getItem('preferred_lang') || 'id';

    if (!username || username.length < 3 || username.length > 16) {
        if (loginStatus) loginStatus.textContent = currentLang === 'en' ? 'Username must be 3-16 characters!' : 'Username harus 3-16 karakter!';
        return;
    }

    const turnstileToken = document.querySelector('#loginScreen [name="cf-turnstile-response"]')?.value;
    if (!turnstileToken) {
        if (loginStatus) {
            loginStatus.style.color = '#ef4444';
            loginStatus.textContent = currentLang === 'en' ? 'Please complete security check.' : 'Harap selesaikan verifikasi keamanan!';
        }
        return;
    }

    isSearching = true;
    if (loginStatus) {
        loginStatus.style.color = 'var(--text-muted)';
        loginStatus.textContent = currentLang === 'en' ? 'Connecting to networks & fetching profile...' : 'Menghubungkan ke jaringan & mengambil profil...';
    }

    try {
        const response = await fetch(`/api/track/${encodeURIComponent(username)}`, {
            headers: { 'X-Turnstile-Token': turnstileToken }
        });
        const data = await response.json();

        if (response.status !== 200) {
            if (loginStatus) {
                loginStatus.style.color = '#ef4444';
                loginStatus.textContent = data.error || 'Player tidak ditemukan.';
            }
            return;
        }

        const playerNameEl = document.getElementById('playerName');
        if (playerNameEl) playerNameEl.textContent = escapeHtml(data.username);
        if (uuidTextEl) uuidTextEl.textContent = `UUID: ${escapeHtml(data.uuid)}`;

        if (!skinViewer) initSkinViewer();
        loadPlayerSkin(data.uuid);

        const headAvatarLink = document.getElementById('headAvatarLink');
        if (headAvatarLink) headAvatarLink.href = safeUrl(data.skins.avatar_head);
        const rawSkinLink = document.getElementById('rawSkinLink');
        if (rawSkinLink) rawSkinLink.href = safeUrl(data.skins.raw_skin);

        if (tierProviders) {
            tierProviders.innerHTML = '';
            data.providers.forEach(source => {
                let tiersHtml = '';
                if (source.tiers && source.tiers.length > 0) {
                    source.tiers.forEach(t => {
                        const tierColor = getTierColor(t.rank);
                        const safeMode = escapeHtml(t.mode);
                        const safeRank = escapeHtml(t.rank);
                        const safeIcon = safeUrl(t.icon);
                        tiersHtml += `<div class="tier-card"><div class="mode-box"><img src="${safeIcon}" class="item-icon" alt="${safeMode}" onerror="this.onerror=null;this.src='${FALLBACK_ICON}';"><span class="mode">${safeMode}</span></div><span class="rank" style="color: ${escapeHtml(tierColor)}">${safeRank}</span></div>`;
                    });
                } else {
                    const unrankedTextVal = (currentTranslations[currentLang] && currentTranslations[currentLang].unrankedText) ? currentTranslations[currentLang].unrankedText : "Unranked / No Data";
                    tiersHtml = `<div class="unranked-tag">${escapeHtml(unrankedTextVal)}</div>`;
                }
                tierProviders.innerHTML += `<div class="provider-block"><span class="provider-title">${escapeHtml(source.provider)}</span><div class="tier-grid">${tiersHtml}</div></div>`;
            });
        }

        if (loginStatus) loginStatus.textContent = '';
        usernameInput.value = '';
        switchScreen('dashboardScreen');
    } catch (err) {
        if (loginStatus) {
            loginStatus.style.color = '#ef4444';
            loginStatus.textContent = currentLang === 'en' ? 'Connection error.' : 'Koneksi error. Pastikan server backend aktif.';
        }
    } finally {
        isSearching = false;
        if (typeof turnstile !== 'undefined') turnstile.reset();
    }
}

// Modpack
let modpackPresets = [];
let selectedPresetId = null;
let modpackDataLoaded = false;
let checkTimeout = null;
let modSearchTimeout = null;
let customMods = [];

const presetGrid = document.getElementById('presetGrid');
const mcVersionInput = document.getElementById('mcVersionInput');
const modLoaderSelect = document.getElementById('modLoaderSelect');
const modBadgeList = document.getElementById('modBadgeList');
const modpackStatus = document.getElementById('modpackStatus');
const downloadModpackBtn = document.getElementById('downloadModpackBtn');
const downloadBtnText = document.getElementById('downloadBtnText');
const downloadSpinner = document.getElementById('downloadSpinner');
const modSearchInput = document.getElementById('modSearchInput');
const modSearchResults = document.getElementById('modSearchResults');
const customModBadgeList = document.getElementById('customModBadgeList');

async function loadModpackPresets() {
    if (modpackDataLoaded || !presetGrid) return;
    try {
        const response = await fetch('/api/modpacks');
        const data = await response.json();
        modpackPresets = data.presets || [];
        renderPresetGrid();
        modpackDataLoaded = true;
    } catch (err) {
        if (presetGrid) presetGrid.innerHTML = '<span class="modlist-empty">Gagal memuat preset. Pastikan server aktif.</span>';
    }
}

function renderPresetGrid() {
    if (!presetGrid) return;
    if (!modpackPresets.length) {
        presetGrid.innerHTML = '<span class="modlist-empty">Belum ada preset tersedia.</span>';
        return;
    }
    const currentLang = localStorage.getItem('preferred_lang') || 'id';

    presetGrid.innerHTML = modpackPresets.map(preset => {
        const name = (preset.name && typeof preset.name === 'object')
            ? (preset.name[currentLang] || preset.name.id || '')
            : (preset.name || '');
        const desc = (preset.description && typeof preset.description === 'object')
            ? (preset.description[currentLang] || preset.description.id || '')
            : (preset.description || '');

        const rawIcon = preset.icon || '';
        const iconHtml = rawIcon.trim().startsWith('<svg') ? rawIcon : escapeHtml(rawIcon || '?');

        return `
            <button type="button" class="preset-card" data-preset-id="${escapeHtml(preset.id)}" onclick="selectPreset('${escapeHtml(preset.id)}')">
                <span class="preset-icon">${iconHtml}</span>
                <span class="preset-name">${escapeHtml(name)}</span>
                <span class="preset-desc">${escapeHtml(desc)}</span>
            </button>
        `;
    }).join('');
}

function renderModBadges(preset, available = null, missing = null) {
    if (!preset.mods || !preset.mods.length) {
        modBadgeList.innerHTML = '<span class="modlist-empty">Preset ini belum memiliki daftar mod.</span>';
        return;
    }
    if (available === null && missing === null) {
        modBadgeList.innerHTML = preset.mods.map(mod => `<span class="mod-badge"><span class="mod-badge-dot"></span>${escapeHtml(mod.name)}</span>`).join('');
    } else {
        let html = '';
        available.forEach(name => {
            html += `<span class="mod-badge"><span class="mod-badge-dot" style="background: #34d399; box-shadow: 0 0 8px #34d399;"></span>${escapeHtml(name)}</span>`;
        });
        missing.forEach(name => {
            html += `<span class="mod-badge missing"><span class="mod-badge-dot" style="background: #ef4444; box-shadow: 0 0 8px #ef4444;"></span><span style="text-decoration: line-through;">${escapeHtml(name)}</span></span>`;
        });
        modBadgeList.innerHTML = html;
    }
}

async function checkModpackCompatibility() {
    if (!mcVersionInput || !selectedPresetId || !modLoaderSelect) return;
    const version = mcVersionInput.value.trim();
    const loader = modLoaderSelect.value;
    if (version.length < 4) return;
    modBadgeList.innerHTML = '<span class="modlist-empty">Mengecek ketersediaan mod di Modrinth...</span>';
    if (modpackStatus) modpackStatus.textContent = '';
    try {
        const res = await fetch('/api/modpack/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ preset_id: selectedPresetId, version, loader })
        });
        const data = await res.json();
        if (res.ok) {
            const preset = modpackPresets.find(p => p.id === selectedPresetId);
            renderModBadges(preset, data.available, data.missing);
            if (modpackStatus) {
                if (data.missing.length > 0) {
                    modpackStatus.style.color = '#fb923c';
                    modpackStatus.textContent = `Peringatan: ${data.missing.length} mod tidak tersedia untuk versi ${version}.`;
                } else {
                    modpackStatus.style.color = '#34d399';
                    modpackStatus.textContent = `Semua mod preset tersedia untuk versi ${version}.`;
                }
            }
        }
    } catch (err) {
        if (modpackStatus) modpackStatus.textContent = "Gagal memverifikasi mod.";
    }
}

function selectPreset(presetId) {
    selectedPresetId = presetId;
    updateDownloadBtnState();
    document.querySelectorAll('.preset-card').forEach(card => {
        const isSelected = card.dataset.presetId === presetId;
        card.classList.toggle('selected', isSelected);
        card.classList.toggle('active-highlight', isSelected);
    });
    const preset = modpackPresets.find(p => p.id === presetId);
    if (!preset) return;
    if (preset.recommended_loader && modLoaderSelect) modLoaderSelect.value = preset.recommended_loader;
    renderModBadges(preset);
    if (modpackStatus) modpackStatus.textContent = '';
    if (mcVersionInput && mcVersionInput.value.length >= 4) checkModpackCompatibility();
}

if (modSearchInput) {
    modSearchInput.addEventListener('input', () => {
        clearTimeout(modSearchTimeout);
        const query = modSearchInput.value.trim();
        if (query.length < 3) {
            modSearchResults.classList.add('hidden');
            return;
        }
        modSearchTimeout = setTimeout(() => fetchModSearchResults(query), 600);
    });
}

async function fetchModSearchResults(query) {
    const version = mcVersionInput ? mcVersionInput.value.trim() : '';
    const loader = modLoaderSelect ? modLoaderSelect.value : '';
    if (version.length < 4) {
        modSearchResults.innerHTML = '<div class="mod-search-item"><span class="mod-search-desc">Isi versi Minecraft terlebih dahulu (misal: 1.20.4)</span></div>';
        modSearchResults.classList.remove('hidden');
        return;
    }
    try {
        const res = await fetch('/api/modpack/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, version, loader })
        });
        const data = await res.json();
        if (!data.results || data.results.length === 0) {
            modSearchResults.innerHTML = '<div class="mod-search-item"><span class="mod-search-desc">Mod tidak ditemukan atau tidak kompatibel.</span></div>';
        } else {
            modSearchResults.innerHTML = data.results.map(mod => `
                <div class="mod-search-item" onclick="addCustomMod('${escapeHtml(mod.slug)}', '${escapeHtml(mod.name).replace(/'/g, "\\'")}')">
                    <img src="${mod.icon ? escapeHtml(mod.icon) : FALLBACK_ICON}" class="mod-search-icon" onerror="this.src='${FALLBACK_ICON}'">
                    <div class="mod-search-info"><span class="mod-search-name">${escapeHtml(mod.name)}</span><span class="mod-search-desc">${escapeHtml(mod.desc || '')}</span></div>
                </div>`).join('');
        }
        modSearchResults.classList.remove('hidden');
    } catch (err) {
        console.error(err);
    }
}

window.addCustomMod = function (slug, name) {
    if (!customMods.find(m => m.slug === slug)) {
        customMods.push({ slug, name });
        renderCustomMods();
        updateDownloadBtnState();
    }
    modSearchResults.classList.add('hidden');
    modSearchInput.value = '';
};

window.removeCustomMod = function (slug) {
    customMods = customMods.filter(m => m.slug !== slug);
    renderCustomMods();
    updateDownloadBtnState();
};

function renderCustomMods() {
    if (customMods.length === 0) {
        customModBadgeList.innerHTML = '';
        return;
    }
    customModBadgeList.innerHTML = customMods.map(mod => `
        <span class="mod-badge custom-mod-badge">
            <span class="mod-badge-dot" style="background: #34d399; box-shadow: 0 0 8px #34d399;"></span>${escapeHtml(mod.name)}
            <span class="remove-mod" onclick="removeCustomMod('${escapeHtml(mod.slug)}')">✕</span>
        </span>`).join('');
}

if (mcVersionInput) {
    mcVersionInput.addEventListener('input', () => {
        clearTimeout(checkTimeout);
        checkTimeout = setTimeout(checkModpackCompatibility, 800);
    });
}

if (modLoaderSelect) {
    modLoaderSelect.addEventListener('change', () => {
        clearTimeout(checkTimeout);
        checkModpackCompatibility();
    });
}

document.addEventListener('click', (e) => {
    if (modSearchResults && !modSearchResults.contains(e.target) && e.target !== modSearchInput) {
        modSearchResults.classList.add('hidden');
    }
});

function updateDownloadBtnState() {
    if (!downloadModpackBtn) return;
    const canDownload = selectedPresetId !== null || customMods.length > 0;
    downloadModpackBtn.disabled = !canDownload;
}

function setModpackDownloading(isLoading) {
    if (!downloadModpackBtn) return;
    const canDownload = selectedPresetId !== null || customMods.length > 0;
    downloadModpackBtn.disabled = isLoading || !canDownload;
    if (downloadBtnText) downloadBtnText.textContent = isLoading ? 'Menyiapkan modpack...' : 'Download Modpack (.zip)';
    if (downloadSpinner) downloadSpinner.classList.toggle('hidden', !isLoading);
}

async function handleModpackDownload() {
    const version = mcVersionInput.value.trim();
    const loader = modLoaderSelect.value;
    if (version.length < 4) {
        if (modpackStatus) {
            modpackStatus.style.color = '#ef4444';
            modpackStatus.textContent = 'Harap isi versi Minecraft dengan benar!';
        }
        return;
    }

    const turnstileToken = document.querySelector('#modpackScreen [name="cf-turnstile-response"]')?.value;
    if (!turnstileToken) {
        if (modpackStatus) {
            modpackStatus.style.color = '#ef4444';
            modpackStatus.textContent = 'Harap selesaikan verifikasi keamanan!';
        }
        return;
    }

    setModpackDownloading(true);
    if (modpackStatus) {
        modpackStatus.style.color = 'var(--text-muted)';
        modpackStatus.textContent = 'Menghubungi server Modrinth...';
    }

    try {
        const response = await fetch('/api/modpack/download', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Turnstile-Token': turnstileToken
            },
            body: JSON.stringify({ preset_id: selectedPresetId, version, loader, custom_mods: customMods })
        });

        const data = await response.json();

        if (!response.ok) {
            if (modpackStatus) {
                modpackStatus.style.color = '#ef4444';
                modpackStatus.textContent = data.error || 'Gagal menyiapkan modpack.';
            }
            return;
        }

        if (data.files.length === 0) {
            if (modpackStatus) {
                modpackStatus.style.color = '#ef4444';
                modpackStatus.textContent = 'Tidak ada mod yang tersedia untuk versi ini.';
            }
            return;
        }

        const zip = new JSZip();
        const modsFolder = zip.folder("mods");
        zip.file("modpack.json", JSON.stringify(data.manifest, null, 2));

        let downloadedCount = 0;
        const totalFiles = data.files.length;

        for (const fileObj of data.files) {
            if (modpackStatus) modpackStatus.textContent = `Mendownload ${fileObj.name} (${downloadedCount + 1}/${totalFiles})...`;
            try {
                const modRes = await fetch(fileObj.url);
                if (!modRes.ok) throw new Error(`HTTP ${modRes.status}`);
                const blob = await modRes.blob();
                modsFolder.file(fileObj.filename, blob);
                downloadedCount++;
            } catch (err) {
                console.warn(`Gagal download ${fileObj.filename}`, err);
            }
        }

        if (modpackStatus) modpackStatus.textContent = 'Merakit file .zip...';

        const content = await zip.generateAsync({ type: "blob" });
        const downloadUrl = window.URL.createObjectURL(content);
        const a = document.createElement('a');

        a.href = downloadUrl;
        a.download = `${selectedPresetId || 'custom'}_${version}_${loader}.zip`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(downloadUrl);

        if (modpackStatus) {
            modpackStatus.style.color = '#34d399';
            modpackStatus.textContent = 'Modpack berhasil diunduh!';
        }
    } catch (err) {
        if (modpackStatus) {
            modpackStatus.style.color = '#ef4444';
            modpackStatus.textContent = 'Koneksi error atau unduhan dibatalkan.';
        }
    } finally {
        setModpackDownloading(false);
        if (typeof turnstile !== 'undefined') turnstile.reset();
    }
}

// Feedback
function openFeedbackModal() {
    const modal = document.getElementById('feedbackModal');
    if (modal) modal.classList.remove('hidden');
}

function closeFeedbackModal() {
    const modal = document.getElementById('feedbackModal');
    if (modal) modal.classList.add('hidden');
    const msgEl = document.getElementById('fbMessage');
    if (msgEl) msgEl.value = '';
}

async function submitFeedback() {
    const usernameInput = document.getElementById('fbUsername');
    const messageInput = document.getElementById('fbMessage');

    const username = (usernameInput && usernameInput.value.trim()) || 'Anonim';
    const message = (messageInput && messageInput.value.trim()) || '';

    if (!message) {
        alert('Tulis kritik atau saran');
        return;
    }

    try {
        const response = await fetch('/api/feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, message })
        });

        const result = await response.json();

        if (response.ok && result.success) {
            alert('Kritik & saran sudah terkirim.');
            closeFeedbackModal();
        } else {
            alert('Gagal ngirim: ' + (result.error || 'Terjadi kesalahan.'));
        }
    } catch (err) {
        alert('Gagal terhubung ke server backend.');
    }
}

// Event listener umum
const inputEl = document.getElementById('usernameInput');
if (inputEl) {
    inputEl.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') handleLoginAndSearch();
    });
}

document.addEventListener('contextmenu', event => {
    const tag = event.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    event.preventDefault();
});

document.addEventListener('keydown', event => {
    if (event.ctrlKey && (event.key === 'c' || event.key === 'x' || event.key === 'u' || event.key === 's')) {
        const tag = event.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        event.preventDefault();
    }
    if (event.key === 'Escape') {
        const modal = document.getElementById('feedbackModal');
        if (modal && !modal.classList.contains('hidden')) closeFeedbackModal();
    }
});