/**
 * Kz Stem Player - Core Application Logic
 */

// ==============================
// Configuration
// ==============================
const TRACK_COLORS = [
    '#f472b6', '#60a5fa', '#34d399', '#fbbf24',
    '#a78bfa', '#f87171', '#22d3ee', '#fb923c',
];

const DEMO_STEMS = [
    { name: 'Vocals',  freq: 440,  type: 'sine',    duration: 30 },
    { name: 'Drums',   freq: 0,    type: 'noise',   duration: 30 },
    { name: 'Bass',    freq: 110,  type: 'sine',    duration: 30 },
    { name: 'Synth',   freq: 330,  type: 'triangle', duration: 30 },
];

// ==============================
// DOM References
// ==============================
const dom = {
    homeScreen:     document.getElementById('home-screen'),
    projectSection: document.getElementById('project-section'),
    projectList:    document.getElementById('project-list'),
    dropZone:       document.getElementById('drop-content'),
    fileInput:      document.getElementById('file-input'),
    demoBtn:        document.getElementById('demo-btn'),
    loadingOverlay: document.getElementById('loading-overlay'),
    loadingText:    document.getElementById('loading-text'),
    progressFill:   document.getElementById('progress-fill'),
    app:            document.getElementById('app'),
    homeBtn:        document.getElementById('home-btn'),
    playBtn:        document.getElementById('play-btn'),
    restartBtn:     document.getElementById('restart-btn'),
    iconPlay:       document.querySelector('.icon-play'),
    iconPause:      document.querySelector('.icon-pause'),
    currentTime:    document.getElementById('current-time'),
    totalTime:      document.getElementById('total-time'),
    timeline:       document.getElementById('timeline'),
    timelineFill:   document.getElementById('timeline-fill'),
    timelineHandle: document.getElementById('timeline-handle'),
    channels:       document.getElementById('channels'),
    masterFader:    document.getElementById('master-fader'),
    masterValue:    document.getElementById('master-value'),
    masterFill:     document.getElementById('master-fill'),
    
    // Editor UI
    projectNameInput: document.getElementById('project-name-input'),
    editProjectBtn:   document.getElementById('edit-project-btn'),
    editorScreen:     document.getElementById('editor-screen'),
    editorTitle:      document.getElementById('editor-project-title'),
    editorProjectNameInput: document.getElementById('editor-project-name-input'),
    editorDeleteProjectBtn: document.getElementById('editor-delete-project-btn'),
    editorTrackList:  document.getElementById('editor-track-list'),
    editorFileInput:  document.getElementById('editor-file-input'),
    editorDropContent:document.getElementById('editor-drop-content'),
    editorDoneBtn:    document.getElementById('editor-done-btn'),
    editorCancelBtn:  document.getElementById('editor-cancel-btn'),
    
    // Cloud UI
    cloudSettingsBtn:      document.getElementById('cloud-settings-btn'),
    cloudSettingsScreen:   document.getElementById('cloud-settings-screen'),
    cloudEndpointInput:    document.getElementById('cloud-endpoint-input'),
    cloudBucketInput:      document.getElementById('cloud-bucket-input'),
    cloudAccessKeyInput:   document.getElementById('cloud-access-key-input'),
    cloudSecretKeyInput:   document.getElementById('cloud-secret-key-input'),
    cloudPublicUrlInput:   document.getElementById('cloud-public-url-input'),
    cloudSettingsSaveBtn:  document.getElementById('cloud-settings-save-btn'),
    cloudSettingsCancelBtn:document.getElementById('cloud-settings-cancel-btn'),
    cloudUploadBtn:        document.getElementById('cloud-upload-btn'),
};

// ==============================
// IndexedDB Manager
// ==============================
class DBManager {
    constructor() {
        this.dbName = 'KzStemPlayerDB';
        this.dbVersion = 1;
        this.storeName = 'projects';
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = (e) => reject(e.target.error);

            request.onsuccess = (e) => {
                this.db = e.target.result;
                resolve();
            };

            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName, { keyPath: 'id' });
                }
            };
        });
    }

    async getAllProjects() {
        return new Promise((resolve, reject) => {
            if (!this.db) return resolve([]);
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.getAll();

            request.onsuccess = () => {
                // Return projects without the bulky array buffers for the list
                const list = request.result.map(p => ({
                    id: p.id,
                    name: p.name,
                    date: p.date,
                    trackCount: p.tracks.length
                })).sort((a, b) => b.date - a.date);
                resolve(list);
            };
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async getProject(id) {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject('DB not initialized');
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.get(id);

            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async saveProject(project) {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject('DB not initialized');
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.put(project);

            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async deleteProject(id) {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject('DB not initialized');
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.delete(id);

            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    }
}

// ==============================
// Cloud Manager (Cloudflare R2)
// ==============================
class CloudManager {
    constructor() {
        this.config = this._loadConfig();
    }

    _loadConfig() {
        let config = { endpoint: '', accessKeyId: '', secretAccessKey: '', publicUrl: '', bucketName: '' };
        try {
            const saved = localStorage.getItem('kz_cloud_config');
            if (saved) config = { ...config, ...JSON.parse(saved) };
        } catch (e) {}

        // Check URL query parameters (e.g. ?r2=https://pub-xxx.r2.dev)
        try {
            const params = new URLSearchParams(window.location.search);
            const r2Param = params.get('r2');
            if (r2Param) {
                config.publicUrl = decodeURIComponent(r2Param);
                this.saveConfig(config);
            }
        } catch (e) {}

        return config;
    }

    saveConfig(config) {
        this.config = { ...config };
        localStorage.setItem('kz_cloud_config', JSON.stringify(this.config));
    }

    getConfig() {
        return { ...this.config };
    }

    isConfigured() {
        return !!(this.config.publicUrl);
    }

    isUploadConfigured() {
        return !!(this.config.endpoint && this.config.accessKeyId && this.config.secretAccessKey && this.config.bucketName);
    }

    // --- Public URL Read ---
    async getProjectsJson() {
        if (!this.config.publicUrl) return [];
        try {
            const url = `${this.config.publicUrl.replace(/\/$/, '')}/projects.json?t=${Date.now()}`;
            const resp = await fetch(url);
            if (!resp.ok) {
                if (resp.status === 404) return [];
                throw new Error(`HTTP ${resp.status}`);
            }
            return await resp.json();
        } catch (e) {
            console.warn('Cloud projects.json not found or error:', e);
            return [];
        }
    }

    getAudioUrl(path) {
        return `${this.config.publicUrl.replace(/\/$/, '')}/${path}`;
    }

    // --- S3-compatible Upload (AWS Sig V4) ---
    async uploadFile(key, body, contentType = 'application/octet-stream') {
        if (!this.isUploadConfigured()) throw new Error('Upload not configured');

        const endpoint = this.config.endpoint.replace(/\/$/, '');
        const bucket = this.config.bucketName;
        
        // URI-encode each segment of the key (supports Japanese / special characters)
        const encodedKey = key.split('/').map(encodeURIComponent).join('/');
        const url = `${endpoint}/${bucket}/${encodedKey}`;

        const now = new Date();
        const dateStamp = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
        const shortDate = dateStamp.substring(0, 8);

        // Parse endpoint to get host
        const urlObj = new URL(endpoint);
        const host = `${urlObj.host}`;

        const region = 'auto';
        const service = 's3';
        const scope = `${shortDate}/${region}/${service}/aws4_request`;

        // Create canonical request
        const payloadHash = await this._sha256Hex(body);
        const canonicalUri = `/${bucket}/${encodedKey}`;
        const canonicalQueryString = '';
        const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${dateStamp}\n`;
        const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';

        const canonicalRequest = `PUT\n${canonicalUri}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

        // Create string to sign
        const canonicalRequestHash = await this._sha256Hex(new TextEncoder().encode(canonicalRequest));
        const stringToSign = `AWS4-HMAC-SHA256\n${dateStamp}\n${scope}\n${canonicalRequestHash}`;

        // Calculate signature
        const signingKey = await this._getSigningKey(this.config.secretAccessKey, shortDate, region, service);
        const signature = await this._hmacHex(signingKey, stringToSign);

        const authorization = `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

        // Do NOT pass 'Host' header in fetch - browsers forbid setting Host header and will reject/ignore it
        const resp = await fetch(url, {
            method: 'PUT',
            headers: {
                'Content-Type': contentType,
                'x-amz-content-sha256': payloadHash,
                'x-amz-date': dateStamp,
                'Authorization': authorization,
            },
            body: body,
        });

        if (!resp.ok) {
            const text = await resp.text();
            throw new Error(`Upload failed: HTTP ${resp.status} ${text}`);
        }
        return true;
    }

    async uploadProjectsJson(projectsArray) {
        const json = JSON.stringify(projectsArray, null, 2);
        const body = new TextEncoder().encode(json);
        return this.uploadFile('projects.json', body, 'application/json');
    }

    // --- AWS Sig V4 Helpers ---
    async _sha256(data) {
        if (typeof data === 'string') data = new TextEncoder().encode(data);
        if (data instanceof ArrayBuffer) data = new Uint8Array(data);
        return await crypto.subtle.digest('SHA-256', data);
    }

    async _sha256Hex(data) {
        if (typeof data === 'string') data = new TextEncoder().encode(data);
        if (data instanceof ArrayBuffer) data = new Uint8Array(data);
        const hash = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    async _hmac(key, data) {
        if (typeof key === 'string') key = new TextEncoder().encode(key);
        if (typeof data === 'string') data = new TextEncoder().encode(data);
        const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, data));
    }

    async _hmacHex(key, data) {
        const result = await this._hmac(key, data);
        return Array.from(result).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    async _getSigningKey(secretKey, dateStamp, region, service) {
        let key = await this._hmac(`AWS4${secretKey}`, dateStamp);
        key = await this._hmac(key, region);
        key = await this._hmac(key, service);
        key = await this._hmac(key, 'aws4_request');
        return key;
    }
}

// ==============================
// Audio Engine
// ==============================
class AudioEngine {
    constructor() {
        this.audioContext = null;
        this.masterGainNode = null;
        this.tracks = [];
        this.isPlaying = false;
        this.startContextTime = 0;
        this.pauseOffset = 0;
        this.duration = 0;
        this.masterVolume = 1.0;
        this.playbackRate = 1.0;
    }

    init() {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGainNode = this.audioContext.createGain();
        this.masterGainNode.connect(this.audioContext.destination);
        this.setMasterVolume(this.masterVolume);
    }

    async resume() {
        if (this.audioContext && this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
    }

    async decodeAudio(arrayBuffer) {
        return this.audioContext.decodeAudioData(arrayBuffer);
    }

    addTrack(name, buffer, color) {
        const gainNode = this.audioContext.createGain();
        gainNode.connect(this.masterGainNode);

        const track = {
            name,
            buffer,
            color,
            gainNode,
            sourceNode: null,
            isMuted: false,
            isSoloed: false,
            volume: 0.8,
        };

        this.tracks.push(track);
        this.duration = Math.max(this.duration, buffer.duration);
        this._updateTrackGain(this.tracks.length - 1);

        return this.tracks.length - 1;
    }

    faderToGain(linearValue) {
        if (linearValue <= 0) return 0;
        if (linearValue >= 1) return 1;
        return Math.pow(linearValue, 2.5);
    }

    _updateTrackGain(index) {
        const track = this.tracks[index];
        const anySoloed = this.tracks.some(t => t.isSoloed);

        let effectiveGain;

        if (anySoloed) {
            if (track.isSoloed && !track.isMuted) {
                effectiveGain = this.faderToGain(track.volume);
            } else {
                effectiveGain = 0;
            }
        } else {
            if (track.isMuted) {
                effectiveGain = 0;
            } else {
                effectiveGain = this.faderToGain(track.volume);
            }
        }

        track.gainNode.gain.setTargetAtTime(
            effectiveGain,
            this.audioContext.currentTime,
            0.015
        );
    }

    _updateAllGains() {
        for (let i = 0; i < this.tracks.length; i++) {
            this._updateTrackGain(i);
        }
    }

    setMasterVolume(value) {
        this.masterVolume = value;
        if(this.masterGainNode) {
            const gain = this.faderToGain(value);
            this.masterGainNode.gain.setTargetAtTime(
                gain,
                this.audioContext.currentTime,
                0.015
            );
        }
    }

    play() {
        if (this.isPlaying) return;
        this.resume();

        if (this.pauseOffset >= this.duration) {
            this.pauseOffset = 0;
        }

        const startTime = this.audioContext.currentTime;

        this.tracks.forEach(track => {
            const source = this.audioContext.createBufferSource();
            source.buffer = track.buffer;
            source.connect(track.gainNode);

            const offset = Math.min(this.pauseOffset, track.buffer.duration);
            const remaining = track.buffer.duration - offset;

            if (remaining > 0) {
                source.playbackRate.value = this.playbackRate;
                source.start(startTime, offset);
            }

            track.sourceNode = source;
        });

        this.startContextTime = startTime;
        this.isPlaying = true;
    }

    setPlaybackRate(rate) {
        this.playbackRate = rate;
        if (this.isPlaying) {
            // Calculate elapsed time before changing rate
            const elapsed = (this.audioContext.currentTime - this.startContextTime) * this.tracks[0].sourceNode.playbackRate.value;
            this.pauseOffset += elapsed;
            this.startContextTime = this.audioContext.currentTime;

            // Apply new rate to all running sources
            this.tracks.forEach(track => {
                if (track.sourceNode) {
                    track.sourceNode.playbackRate.setValueAtTime(rate, this.audioContext.currentTime);
                }
            });
        }
    }

    stop() {
        if (!this.isPlaying) return;

        this.pauseOffset += this.audioContext.currentTime - this.startContextTime;
        if (this.pauseOffset > this.duration) {
            this.pauseOffset = this.duration;
        }

        this.tracks.forEach(track => {
            if (track.sourceNode) {
                try { track.sourceNode.stop(); } catch (e) {}
                track.sourceNode.disconnect();
                track.sourceNode = null;
            }
        });

        this.isPlaying = false;
    }

    seek(time) {
        const wasPlaying = this.isPlaying;
        if (wasPlaying) {
            this.stop();
        }
        this.pauseOffset = Math.max(0, Math.min(time, this.duration));
        if (wasPlaying) {
            this.play();
        }
    }

    getCurrentTime() {
        if (this.isPlaying) {
            const elapsed = this.pauseOffset + (this.audioContext.currentTime - this.startContextTime) * this.playbackRate;
            return Math.min(elapsed, this.duration);
        }
        return this.pauseOffset;
    }

    toggleMute(index) {
        this.tracks[index].isMuted = !this.tracks[index].isMuted;
        this._updateAllGains();
    }

    toggleSolo(index) {
        this.tracks[index].isSoloed = !this.tracks[index].isSoloed;
        this._updateAllGains();
    }

    setTrackVolume(index, value) {
        this.tracks[index].volume = value;
        this._updateTrackGain(index);
    }
    
    setTrackName(index, name) {
        this.tracks[index].name = name;
    }

    destroy() {
        this.stop();
        this.tracks.forEach(track => {
            track.gainNode.disconnect();
        });
        this.tracks = [];
        this.duration = 0;
        this.pauseOffset = 0;
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
    }

    generateDemoBuffer(freq, type, duration) {
        const sampleRate = this.audioContext.sampleRate;
        const length = Math.floor(sampleRate * duration);
        const buffer = this.audioContext.createBuffer(2, length, sampleRate);

        for (let ch = 0; ch < 2; ch++) {
            const data = buffer.getChannelData(ch);
            for (let i = 0; i < length; i++) {
                const t = i / sampleRate;

                let sample = 0;
                if (type === 'noise') {
                    const beatInterval = 0.5;
                    const beatPos = t % beatInterval;
                    const envelope = Math.exp(-beatPos * 12);
                    sample = (Math.random() * 2 - 1) * envelope * 0.6;
                } else if (type === 'sine') {
                    const vibrato = Math.sin(2 * Math.PI * 5 * t) * 3;
                    sample = Math.sin(2 * Math.PI * (freq + vibrato) * t) * 0.4;
                    sample *= 0.7 + 0.3 * Math.sin(2 * Math.PI * 0.25 * t);
                } else if (type === 'triangle') {
                    const f1 = freq;
                    const f2 = freq * 1.5;
                    const f3 = freq * 1.25;
                    const tri = (f) => {
                        const p = (f * t) % 1;
                        return 4 * Math.abs(p - 0.5) - 1;
                    };
                    sample = (tri(f1) + tri(f2) * 0.6 + tri(f3) * 0.5) * 0.2;
                }

                const fadeTime = 0.02;
                if (t < fadeTime) sample *= t / fadeTime;
                if (t > duration - fadeTime) sample *= (duration - t) / fadeTime;

                data[i] = sample;
            }
        }
        return buffer;
    }
}

// ==============================
// UI Controller
// ==============================
class UIController {
    constructor(engine, db, cloud) {
        this.engine = engine;
        this.db = db;
        this.cloud = cloud;
        this.animationId = null;
        this.isSeeking = false;
        this.currentProjectId = null;
        this.cloudProjects = []; // Cached cloud projects list
        
        // Temporarily holds tracks when editing
        this.editorTracks = [];
        
        this.init().then(() => this._bindEvents());
    }
    
    async init() {
        try {
            await this.db.init();
            await this._loadCloudProjects();
            this._renderProjectsList();
        } catch(e) {
            console.error("DB Initialization failed", e);
        }
    }

    async _loadCloudProjects() {
        if (this.cloud.isConfigured()) {
            try {
                this.cloudProjects = await this.cloud.getProjectsJson();
            } catch (e) {
                console.warn('Failed to load cloud projects:', e);
                this.cloudProjects = [];
            }
        }
    }

    _bindEvents() {
        // Home Screen
        dom.fileInput.addEventListener('change', (e) => this._handleFiles(e.target.files));
        dom.demoBtn.addEventListener('click', () => this._loadDemo());

        dom.dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dom.dropZone.classList.add('drag-over');
        });
        dom.dropZone.addEventListener('dragleave', () => {
            dom.dropZone.classList.remove('drag-over');
        });
        dom.dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dom.dropZone.classList.remove('drag-over');
            if (e.dataTransfer.files.length > 0) {
                this._handleFiles(e.dataTransfer.files);
            }
        });

        // App Header
        dom.homeBtn.addEventListener('click', () => this._goHome());
        dom.projectNameInput.addEventListener('change', (e) => {
            if (this.currentProjectId) {
                this._updateCurrentProjectName(e.target.value);
            }
        });
        dom.editProjectBtn.addEventListener('click', () => this._openEditor());

        // Editor Screen
        dom.editorCancelBtn.addEventListener('click', () => this._closeEditor());
        dom.editorDoneBtn.addEventListener('click', () => this._saveEditorChanges());
        dom.editorDeleteProjectBtn.addEventListener('click', () => this._deleteProjectFromEditor());
        dom.editorFileInput.addEventListener('change', (e) => this._addTracksToEditor(e.target.files));
        
        // Editor Drop Zone
        dom.editorDropContent.addEventListener('dragover', (e) => {
            e.preventDefault();
            dom.editorDropContent.classList.add('drag-over');
        });
        dom.editorDropContent.addEventListener('dragleave', () => {
            dom.editorDropContent.classList.remove('drag-over');
        });
        dom.editorDropContent.addEventListener('drop', (e) => {
            e.preventDefault();
            dom.editorDropContent.classList.remove('drag-over');
            if (e.dataTransfer.files.length > 0) {
                this._addTracksToEditor(e.dataTransfer.files);
            }
        });

        // Transport
        dom.playBtn.addEventListener('click', () => this._togglePlay());
        dom.restartBtn.addEventListener('click', () => this._restart());

        // Timeline
        dom.timeline.addEventListener('mousedown', (e) => this._startSeek(e));
        document.addEventListener('mousemove', (e) => this._moveSeek(e));
        document.addEventListener('mouseup', () => this._endSeek());
        
        dom.timeline.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this._startSeek(e.touches[0]);
        });
        document.addEventListener('touchmove', (e) => {
            if (this.isSeeking) this._moveSeek(e.touches[0]);
        });
        document.addEventListener('touchend', () => this._endSeek());

        // Tempo buttons
        const tempoBtns = document.querySelectorAll('.tempo-btn');
        tempoBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                tempoBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const rate = parseFloat(btn.dataset.tempo);
                this.engine.setPlaybackRate(rate);
            });
        });

        // Master fader
        dom.masterFader.addEventListener('input', (e) => {
            const val = parseInt(e.target.value, 10);
            this.engine.setMasterVolume(val / 100);
            dom.masterValue.textContent = val;
            dom.masterFill.style.setProperty('--fill-pct', `${val}%`);
        });
        
        dom.masterFader.addEventListener('dblclick', () => {
            dom.masterFader.value = 100;
            this.engine.setMasterVolume(1.0);
            dom.masterValue.textContent = 100;
            dom.masterFill.style.setProperty('--fill-pct', '100%');
        });

        // Keyboard
        document.addEventListener('keydown', (e) => {
            // ignore if focus is on text inputs
            if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
            if (e.code === 'Space') {
                e.preventDefault();
                this._togglePlay();
            }
        });

        // Cloud Settings
        if (dom.cloudSettingsBtn) {
            dom.cloudSettingsBtn.addEventListener('click', () => this._openCloudSettings());
        }
        if (dom.cloudSettingsSaveBtn) {
            dom.cloudSettingsSaveBtn.addEventListener('click', () => this._saveCloudSettings());
        }
        if (dom.cloudSettingsCancelBtn) {
            dom.cloudSettingsCancelBtn.addEventListener('click', () => this._closeCloudSettings());
        }
        if (dom.cloudUploadBtn) {
            dom.cloudUploadBtn.addEventListener('click', () => this._uploadToCloud());
        }
    }
    
    // ----------------------------
    // Project Management
    // ----------------------------
    async _renderProjectsList() {
        try {
            const projects = await this.db.getAllProjects();
            dom.projectList.innerHTML = '';
            
            const hasLocal = projects.length > 0;
            const hasCloud = this.cloudProjects.length > 0;
            
            if (hasLocal || hasCloud) {
                dom.projectSection.classList.remove('hidden');
                
                // Render cloud projects first
                if (hasCloud) {
                    this.cloudProjects.forEach(cp => {
                        const el = document.createElement('div');
                        el.className = 'project-item project-item-cloud';
                        
                        el.innerHTML = `
                            <div class="project-item-info">
                                <span class="project-item-name">
                                    <svg class="cloud-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path>
                                    </svg>
                                    ${this._escapeHtml(cp.name)}
                                </span>
                            </div>
                            <div style="display: flex; gap: 12px; align-items: center;">
                                <span class="project-item-tracks">${cp.tracks.length} Tracks</span>
                                <span class="cloud-badge">Cloud</span>
                            </div>
                        `;
                        
                        el.addEventListener('click', () => this._loadCloudProject(cp));
                        dom.projectList.appendChild(el);
                    });
                }
                
                // Render local projects
                projects.forEach(p => {
                    const el = document.createElement('div');
                    el.className = 'project-item';
                    const dateStr = new Date(p.date).toLocaleString();
                    
                    el.innerHTML = `
                        <div class="project-item-info">
                            <span class="project-item-name">${this._escapeHtml(p.name)}</span>
                            <span class="project-item-date">${dateStr}</span>
                        </div>
                        <div style="display: flex; gap: 12px; align-items: center;">
                            <span class="project-item-tracks">${p.trackCount} Tracks</span>
                            <button class="project-item-edit" title="プロジェクトを編集">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M12 20h9"></path>
                                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                                </svg>
                            </button>
                        </div>
                    `;
                    
                    el.addEventListener('click', (e) => {
                        if(e.target.closest('.project-item-edit')) return;
                        this._loadProjectFromDB(p.id);
                    });
                    
                    const editBtn = el.querySelector('.project-item-edit');
                    editBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this._openEditor(p.id);
                    });
                    
                    dom.projectList.appendChild(el);
                });
            } else {
                dom.projectSection.classList.add('hidden');
            }
        } catch(e) {
            console.error("Failed to fetch projects", e);
        }
    }

    async _saveCurrentProject(projectName, filesData) {
        const project = {
            id: Date.now().toString(),
            name: projectName || 'Untitled Project',
            date: Date.now(),
            tracks: filesData // {name, buffer(ArrayBuffer), color}
        };
        try {
            this.currentProjectId = project.id;
            await this.db.saveProject(project);
            this._renderProjectsList();
        } catch(e) {
            console.error("Failed to save project", e);
        }
    }

    async _updateCurrentProjectName(newName) {
        if (!this.currentProjectId) return;
        try {
            const project = await this.db.getProject(this.currentProjectId);
            if (project) {
                project.name = newName;
                await this.db.saveProject(project);
                this._renderProjectsList();
            }
        } catch (e) {
            console.error("Failed to update project name", e);
        }
    }

    async _updateCurrentProject() {
        if (!this.currentProjectId) return;
        try {
            const project = await this.db.getProject(this.currentProjectId);
            if (project) {
                // Update track names
                this.engine.tracks.forEach((track, index) => {
                    if (project.tracks[index]) {
                        project.tracks[index].name = track.name;
                    }
                });
                await this.db.saveProject(project);
                this._renderProjectsList();
            }
        } catch (e) {
            console.error("Failed to update project", e);
        }
    }

    async _loadProjectFromDB(id) {
        try {
            this._showLoading();
            const project = await this.db.getProject(id);
            if(!project) throw new Error("Project not found");
            
            this.currentProjectId = id;
            
            this.engine.destroy();
            this.engine.init();
            
            dom.projectNameInput.value = project.name;
            
            const total = project.tracks.length;
            let loaded = 0;
            
            for(let i = 0; i < total; i++) {
                const t = project.tracks[i];
                dom.loadingText.textContent = `${t.name} を読み込み中... (${i + 1}/${total})`;
                
                // create a copy of the ArrayBuffer because decodeAudioData detaches the buffer
                const bufferCopy = t.buffer.slice(0); 
                const audioBuffer = await this.engine.decodeAudio(bufferCopy);
                this.engine.addTrack(t.name, audioBuffer, t.color);
                
                loaded++;
                dom.progressFill.style.width = `${(loaded / total) * 100}%`;
            }
            
            this._initMixer();
            
        } catch(e) {
            console.error(e);
            alert("プロジェクトの読み込みに失敗しました");
            this._goHome();
        }
    }

    // ----------------------------
    // File Loading
    // ----------------------------
    async _handleFiles(files) {
        if (!files || files.length === 0) return;

        let projectName = prompt("プロジェクト名を入力してください", "New Project");
        if(projectName === null) return; // Cancelled
        
        this.engine.destroy();
        this.engine.init();
        this._showLoading();

        const fileArray = Array.from(files);
        const total = fileArray.length;
        let loaded = 0;
        
        const filesDataToSave = [];

        for (let i = 0; i < total; i++) {
            const file = fileArray[i];
            const name = file.name.replace(/\.[^/.]+$/, '');
            const color = TRACK_COLORS[i % TRACK_COLORS.length];

            dom.loadingText.textContent = `${name} を読み込み中... (${i + 1}/${total})`;

            try {
                const arrayBuffer = await file.arrayBuffer();
                
                // Save original ArrayBuffer for DB
                filesDataToSave.push({
                    name: name,
                    color: color,
                    buffer: arrayBuffer.slice(0) // Copy before decoding
                });
                
                const audioBuffer = await this.engine.decodeAudio(arrayBuffer);
                this.engine.addTrack(name, audioBuffer, color);
            } catch (err) {
                console.error(`Failed to decode ${name}:`, err);
                dom.loadingText.textContent = `⚠ ${name} の読み込みに失敗しました`;
                await this._delay(1000);
            }

            loaded++;
            dom.progressFill.style.width = `${(loaded / total) * 100}%`;
        }

        if (this.engine.tracks.length > 0) {
            // Save to indexedDB
            dom.projectNameInput.value = projectName;
            await this._saveCurrentProject(projectName, filesDataToSave);
            this._initMixer();
        } else {
            alert('有効なオーディオファイルが見つかりませんでした。');
            this._goHome();
        }
    }

    async _loadDemo() {
        this.engine.destroy();
        this.engine.init();
        this._showLoading();

        this.currentProjectId = null;
        const total = DEMO_STEMS.length;
        
        // We do not save demo to IndexedDB to keep it clean, just run it.

        for (let i = 0; i < total; i++) {
            const stem = DEMO_STEMS[i];
            const color = TRACK_COLORS[i % TRACK_COLORS.length];

            dom.loadingText.textContent = `${stem.name} を生成中... (${i + 1}/${total})`;
            dom.progressFill.style.width = `${((i + 1) / total) * 100}%`;
            await this._delay(100);

            const buffer = this.engine.generateDemoBuffer(stem.freq, stem.type, stem.duration);
            this.engine.addTrack(stem.name, buffer, color);
        }

        this._initMixer();
    }

    // ----------------------------
    // Mixer Initialization
    // ----------------------------
    _initMixer() {
        dom.channels.innerHTML = '';
        this.engine.tracks.forEach((track, index) => {
            const channelEl = this._createChannelStrip(track, index);
            dom.channels.appendChild(channelEl);
        });

        dom.totalTime.textContent = this._formatTime(this.engine.duration);
        dom.currentTime.textContent = '0:00';
        dom.timelineFill.style.width = '0%';
        dom.timelineHandle.style.left = '0%';

        dom.loadingOverlay.classList.add('hidden');
        dom.homeScreen.classList.add('hidden');
        dom.editorScreen.classList.add('hidden');
        dom.app.classList.remove('hidden');

        // デモの場合などは currentProjectId がない
        if (this.currentProjectId) {
            dom.editProjectBtn.classList.remove('hidden');
            dom.projectNameInput.removeAttribute('readonly');
            // クラウドアップロードボタンの表示（管理者のみ）
            if (dom.cloudUploadBtn && this.cloud.isUploadConfigured()) {
                dom.cloudUploadBtn.classList.remove('hidden');
            }
        } else {
            dom.editProjectBtn.classList.add('hidden');
            dom.projectNameInput.value = 'Demo Project';
            dom.projectNameInput.setAttribute('readonly', 'true');
            if (dom.cloudUploadBtn) dom.cloudUploadBtn.classList.add('hidden');
        }

        this._updatePlayButton(false);
    }

    _createChannelStrip(track, index) {
        const channel = document.createElement('div');
        channel.className = 'channel';
        channel.dataset.index = index;

        channel.innerHTML = `
            <div class="channel-header">
                <input type="text" class="channel-name" value="${this._escapeHtml(track.name)}" aria-label="トラック名">
                <div class="channel-color-bar" style="background: ${track.color}"></div>
            </div>
            <div class="channel-controls">
                <div class="channel-buttons">
                    <button class="btn-solo" data-index="${index}" title="Solo">S</button>
                    <button class="btn-mute" data-index="${index}" title="Mute">M</button>
                </div>
            </div>
            <div class="fader-wrapper">
                <div class="fader-track-bg"></div>
                <div class="fader-fill" style="--fill-pct: 80%; --track-color: ${track.color}"></div>
                <input
                    type="range"
                    class="fader"
                    data-index="${index}"
                    min="0"
                    max="100"
                    value="80"
                    style="--track-color: ${track.color}"
                    aria-label="音量"
                >
            </div>
            <div class="channel-value" data-index="${index}">80</div>
        `;
        
        // Track Name Edit
        const nameInput = channel.querySelector('.channel-name');
        nameInput.addEventListener('change', (e) => {
            this.engine.setTrackName(index, e.target.value);
            this._updateCurrentProject();
        });

        // Solo button
        const soloBtn = channel.querySelector('.btn-solo');
        soloBtn.addEventListener('click', () => {
            this.engine.toggleSolo(index);
            this._updateChannelStates();
        });

        // Mute button
        const muteBtn = channel.querySelector('.btn-mute');
        muteBtn.addEventListener('click', () => {
            this.engine.toggleMute(index);
            this._updateChannelStates();
        });

        // Volume fader
        const fader = channel.querySelector('.fader');
        const faderFill = channel.querySelector('.fader-fill');
        const valDisplay = channel.querySelector('.channel-value');
        
        fader.addEventListener('input', (e) => {
            const val = parseInt(e.target.value, 10);
            this.engine.setTrackVolume(index, val / 100);
            valDisplay.textContent = val;
            faderFill.style.setProperty('--fill-pct', `${val}%`);
        });

        fader.addEventListener('dblclick', () => {
            fader.value = 80;
            this.engine.setTrackVolume(index, 0.8);
            valDisplay.textContent = 80;
            faderFill.style.setProperty('--fill-pct', '80%');
        });

        return channel;
    }

    // ----------------------------
    // Transport Controls
    // ----------------------------
    _togglePlay() {
        this.engine.resume();
        if (this.engine.isPlaying) {
            this.engine.stop();
            this._updatePlayButton(false);
            this._stopAnimationLoop();
        } else {
            this.engine.play();
            this._updatePlayButton(true);
            this._startAnimationLoop();
        }
    }

    _restart() {
        const wasPlaying = this.engine.isPlaying;
        if (wasPlaying) this.engine.stop();
        this.engine.pauseOffset = 0;
        if (wasPlaying) {
            this.engine.play();
        }
        this._updateTimeDisplay(0);
    }

    _updatePlayButton(isPlaying) {
        dom.iconPlay.classList.toggle('hidden', isPlaying);
        dom.iconPause.classList.toggle('hidden', !isPlaying);
        dom.playBtn.classList.toggle('is-playing', isPlaying);
    }

    // ----------------------------
    // Timeline Seek
    // ----------------------------
    _startSeek(e) {
        this.isSeeking = true;
        this._seekFromEvent(e);
    }

    _moveSeek(e) {
        if (!this.isSeeking) return;
        this._seekFromEvent(e);
    }

    _endSeek() {
        this.isSeeking = false;
    }

    _seekFromEvent(e) {
        const rect = dom.timeline.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const time = ratio * this.engine.duration;
        this.engine.seek(time);
        this._updateTimeDisplay(time);
    }

    // ----------------------------
    // UI State Updates
    // ----------------------------
    _updateChannelStates() {
        this.engine.tracks.forEach((track, index) => {
            const channel = dom.channels.querySelector(`.channel[data-index="${index}"]`);
            if (!channel) return;
            const soloBtn = channel.querySelector('.btn-solo');
            const muteBtn = channel.querySelector('.btn-mute');
            soloBtn.classList.toggle('active', track.isSoloed);
            muteBtn.classList.toggle('active', track.isMuted);
        });
    }

    _updateTimeDisplay(time) {
        dom.currentTime.textContent = this._formatTime(time);
        const ratio = this.engine.duration > 0 ? (time / this.engine.duration) * 100 : 0;
        dom.timelineFill.style.width = `${ratio}%`;
        dom.timelineHandle.style.left = `${ratio}%`;
    }

    // ----------------------------
    // Animation Loop
    // ----------------------------
    _startAnimationLoop() {
        const loop = () => {
            if (!this.engine.isPlaying) return;
            const currentTime = this.engine.getCurrentTime();
            if (currentTime >= this.engine.duration) {
                this.engine.stop();
                this.engine.pauseOffset = 0;
                this._updatePlayButton(false);
                this._updateTimeDisplay(0);
                return;
            }
            this._updateTimeDisplay(currentTime);
            this.animationId = requestAnimationFrame(loop);
        };
        this.animationId = requestAnimationFrame(loop);
    }

    _stopAnimationLoop() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    // ----------------------------
    // View Management
    // ----------------------------
    _showLoading() {
        dom.homeScreen.classList.add('hidden');
        dom.app.classList.add('hidden');
        dom.loadingOverlay.classList.remove('hidden');
        dom.progressFill.style.width = '0%';
    }

    _goHome() {
        if (this.engine.isPlaying) {
            this.engine.stop();
        }
        this._stopAnimationLoop();
        this.engine.destroy();
        this.engine.init();

        this.currentProjectId = null;

        dom.app.classList.add('hidden');
        dom.loadingOverlay.classList.add('hidden');
        dom.homeScreen.classList.remove('hidden');
        dom.fileInput.value = '';
    }

    // ----------------------------
    // Editor Management
    // ----------------------------
    async _openEditor(projectId = null) {
        const targetId = projectId || this.currentProjectId;
        if (!targetId) return;
        
        if (this.engine.isPlaying) {
            this._togglePlay();
        }

        try {
            const project = await this.db.getProject(targetId);
            if (!project) return;
            
            // Clone tracks array to avoid mutating until "Done"
            this.editorTracks = project.tracks.map(t => ({
                name: t.name,
                color: t.color,
                buffer: t.buffer.slice(0) // Copy array buffer
            }));
            
            // 編集中のプロジェクトIDを一時保存
            this.editingProjectId = targetId;
            
            dom.editorProjectNameInput.value = project.name;
            this._renderEditorTracks();
            
            dom.app.classList.add('hidden');
            dom.homeScreen.classList.add('hidden');
            dom.editorScreen.classList.remove('hidden');
        } catch(e) {
            console.error("Failed to open editor", e);
        }
    }

    _closeEditor() {
        this.editorTracks = [];
        this.editingProjectId = null;
        dom.editorScreen.classList.add('hidden');
        
        // 戻る先を判定
        if (this.currentProjectId) {
            dom.app.classList.remove('hidden');
        } else {
            dom.homeScreen.classList.remove('hidden');
        }
    }

    _renderEditorTracks() {
        dom.editorTrackList.innerHTML = '';
        this.editorTracks.forEach((track, index) => {
            const el = document.createElement('div');
            el.className = 'project-item';
            el.innerHTML = `
                <div class="project-item-info">
                    <span class="project-item-name">${this._escapeHtml(track.name)}</span>
                </div>
                <button class="project-item-delete" title="削除">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>
            `;
            const delBtn = el.querySelector('.project-item-delete');
            delBtn.addEventListener('click', () => {
                this._removeTrackFromEditor(index);
            });
            dom.editorTrackList.appendChild(el);
        });
    }

    _removeTrackFromEditor(index) {
        this.editorTracks.splice(index, 1);
        this._renderEditorTracks();
    }

    async _addTracksToEditor(files) {
        if (!files || files.length === 0) return;
        const fileArray = Array.from(files);
        
        // Show loading state inside editor drop zone momentarily
        const origText = dom.editorDropContent.querySelector('.drop-description').textContent;
        dom.editorDropContent.querySelector('.drop-description').textContent = "読み込み中...";
        
        for (let i = 0; i < fileArray.length; i++) {
            const file = fileArray[i];
            const name = file.name.replace(/\.[^/.]+$/, '');
            // assign a color based on current number of tracks
            const color = TRACK_COLORS[this.editorTracks.length % TRACK_COLORS.length];
            
            try {
                const arrayBuffer = await file.arrayBuffer();
                this.editorTracks.push({
                    name: name,
                    color: color,
                    buffer: arrayBuffer
                });
            } catch (err) {
                console.error(`Failed to read file ${name}:`, err);
            }
        }
        
        dom.editorDropContent.querySelector('.drop-description').textContent = origText;
        dom.editorFileInput.value = '';
        this._renderEditorTracks();
    }

    async _saveEditorChanges() {
        if (!this.editingProjectId) return;
        
        if (this.editorTracks.length === 0) {
            alert('少なくとも1つの音源が必要です。');
            return;
        }
        
        const newProjectName = dom.editorProjectNameInput.value.trim() || 'Untitled Project';

        try {
            dom.editorScreen.classList.add('hidden');
            this._showLoading();
            
            const project = await this.db.getProject(this.editingProjectId);
            project.name = newProjectName;
            project.tracks = this.editorTracks;
            await this.db.saveProject(project);
            
            this.editorTracks = [];
            
            if (this.currentProjectId === this.editingProjectId) {
                // 現在再生中のものを編集した場合は再ロード
                this.editingProjectId = null;
                await this._loadProjectFromDB(this.currentProjectId);
            } else {
                // ホーム画面から別のものを編集した場合はホームへ戻る
                this.editingProjectId = null;
                this._renderProjectsList();
                this._hideLoading();
                this._goHome();
            }
        } catch (e) {
            console.error("Failed to save changes", e);
            this._closeEditor();
            this._hideLoading();
        }
    }

    async _deleteProjectFromEditor() {
        if (!this.editingProjectId) return;
        
        if (confirm('このプロジェクトを完全に削除してもよろしいですか？')) {
            try {
                dom.editorScreen.classList.add('hidden');
                this._showLoading();
                
                await this.db.deleteProject(this.editingProjectId);
                
                if (this.currentProjectId === this.editingProjectId) {
                    this.currentProjectId = null;
                    this.engine.destroy();
                }
                
                this.editorTracks = [];
                this.editingProjectId = null;
                
                this._renderProjectsList();
                this._hideLoading();
                this._goHome();
                
            } catch (e) {
                console.error("Failed to delete project", e);
                this._hideLoading();
                this._closeEditor();
            }
        }
    }

    // ----------------------------
    // Cloud Management
    // ----------------------------
    _openCloudSettings() {
        const config = this.cloud.getConfig();
        dom.cloudEndpointInput.value = config.endpoint || '';
        dom.cloudBucketInput.value = config.bucketName || '';
        dom.cloudAccessKeyInput.value = config.accessKeyId || '';
        dom.cloudSecretKeyInput.value = config.secretAccessKey || '';
        dom.cloudPublicUrlInput.value = config.publicUrl || '';
        dom.cloudSettingsScreen.classList.remove('hidden');
    }

    _closeCloudSettings() {
        dom.cloudSettingsScreen.classList.add('hidden');
    }

    async _saveCloudSettings() {
        const config = {
            endpoint: dom.cloudEndpointInput.value.trim(),
            bucketName: dom.cloudBucketInput.value.trim(),
            accessKeyId: dom.cloudAccessKeyInput.value.trim(),
            secretAccessKey: dom.cloudSecretKeyInput.value.trim(),
            publicUrl: dom.cloudPublicUrlInput.value.trim(),
        };
        this.cloud.saveConfig(config);
        this._closeCloudSettings();
        
        // Reload cloud projects
        await this._loadCloudProjects();
        this._renderProjectsList();
    }

    async _loadCloudProject(cloudProject) {
        try {
            this._showLoading();
            this.engine.destroy();
            this.engine.init();
            this.currentProjectId = null;
            
            dom.projectNameInput.value = cloudProject.name;
            
            const total = cloudProject.tracks.length;
            let loaded = 0;
            
            for (let i = 0; i < total; i++) {
                const t = cloudProject.tracks[i];
                const color = t.color || TRACK_COLORS[i % TRACK_COLORS.length];
                dom.loadingText.textContent = `${t.name} を読み込み中... (${i + 1}/${total})`;
                
                try {
                    const audioUrl = this.cloud.getAudioUrl(t.path);
                    const resp = await fetch(audioUrl);
                    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                    const arrayBuffer = await resp.arrayBuffer();
                    const audioBuffer = await this.engine.decodeAudio(arrayBuffer);
                    this.engine.addTrack(t.name, audioBuffer, color);
                } catch (err) {
                    console.error(`Failed to load cloud track ${t.name}:`, err);
                    dom.loadingText.textContent = `⚠ ${t.name} の読み込みに失敗しました`;
                    await this._delay(1000);
                }
                
                loaded++;
                dom.progressFill.style.width = `${(loaded / total) * 100}%`;
            }
            
            if (this.engine.tracks.length > 0) {
                this._initMixer();
                // クラウドプロジェクトの場合は編集ボタンを非表示
                dom.editProjectBtn.classList.add('hidden');
                dom.projectNameInput.setAttribute('readonly', 'true');
                // クラウドアップロードボタンも非表示
                if (dom.cloudUploadBtn) dom.cloudUploadBtn.classList.add('hidden');
            } else {
                alert('クラウドプロジェクトの読み込みに失敗しました。');
                this._goHome();
            }
        } catch (e) {
            console.error('Failed to load cloud project:', e);
            alert('クラウドプロジェクトの読み込みに失敗しました。');
            this._goHome();
        }
    }

    async _uploadToCloud() {
        if (!this.currentProjectId) {
            alert('アップロードするプロジェクトがありません。');
            return;
        }
        if (!this.cloud.isUploadConfigured()) {
            alert('クラウド設定が完了していません。ホーム画面の⚙ボタンから設定してください。');
            return;
        }
        
        if (!confirm('このプロジェクトをクラウドに公開しますか？\n他の端末からアクセスできるようになります。')) return;
        
        try {
            this._showLoading();
            dom.loadingText.textContent = 'クラウドにアップロード中...';
            
            const project = await this.db.getProject(this.currentProjectId);
            if (!project) throw new Error('Project not found');
            
            // Generate project ID for cloud
            const cloudId = `proj_${Date.now()}`;
            const tracksMeta = [];
            const total = project.tracks.length;
            
            for (let i = 0; i < total; i++) {
                const t = project.tracks[i];
                const ext = 'aac'; // Default extension
                const key = `${cloudId}/${t.name}.${ext}`;
                
                dom.loadingText.textContent = `${t.name} をアップロード中... (${i + 1}/${total})`;
                dom.progressFill.style.width = `${((i + 0.5) / total) * 100}%`;
                
                const body = new Uint8Array(t.buffer);
                await this.cloud.uploadFile(key, body, 'audio/aac');
                
                tracksMeta.push({
                    name: t.name,
                    color: t.color || TRACK_COLORS[i % TRACK_COLORS.length],
                    path: key,
                });
                
                dom.progressFill.style.width = `${((i + 1) / total) * 100}%`;
            }
            
            // Update projects.json
            dom.loadingText.textContent = 'プロジェクト情報を更新中...';
            const existingProjects = await this.cloud.getProjectsJson();
            
            const newCloudProject = {
                id: cloudId,
                name: project.name,
                date: Date.now(),
                tracks: tracksMeta,
            };
            
            existingProjects.push(newCloudProject);
            await this.cloud.uploadProjectsJson(existingProjects);
            
            // Refresh cloud list
            this.cloudProjects = existingProjects;
            this._renderProjectsList();
            
            dom.progressFill.style.width = '100%';
            dom.loadingText.textContent = 'アップロード完了！';
            await this._delay(1500);
            
            // Return to player
            dom.loadingOverlay.classList.add('hidden');
            dom.app.classList.remove('hidden');
            
        } catch (e) {
            console.error('Cloud upload failed:', e);
            let detail = e.message || '不明なエラー';
            if (e.name === 'TypeError' || detail.toLowerCase().includes('fetch')) {
                detail = '通信またはCORSエラーです。\nCloudflare R2バケットの「CORSポリシー」が設定されているか確認してください。';
            } else if (detail.includes('403')) {
                detail = 'アクセスが拒否されました (403 Forbidden)。\nアクセスキー/シークレットキーの権限（Object Read & Write）やバケット名をご確認ください。';
            }
            alert(`アップロードに失敗しました:\n${detail}`);
            dom.loadingOverlay.classList.add('hidden');
            dom.app.classList.remove('hidden');
        }
    }

    // ----------------------------
    // Helpers
    // ----------------------------
    _formatTime(seconds) {
        if (!isFinite(seconds) || seconds < 0) seconds = 0;
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// ==============================
// Initialize Application
// ==============================
const db = new DBManager();
const cloud = new CloudManager();
const engine = new AudioEngine();
engine.init();
const ui = new UIController(engine, db, cloud);
