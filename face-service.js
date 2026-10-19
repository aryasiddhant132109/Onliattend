/**
 * OniAttendance - Face Recognition & Camera Service
 * Powered by face-api.js with local model caching and WebRTC camera stream.
 */

class FaceService {
  constructor() {
    this.isModelsLoaded = false;
    this.isLoadingModels = false;
    this.videoElement = null;
    this.canvasElement = null;
    this.stream = null;
    this.isScanning = false;
    this.scanIntervalId = null;
    this.labeledDescriptors = []; // Array of { id, name, descriptor: Float32Array }
    this.lastRecognizedTime = {}; // Cooldown map: studentId -> timestamp
    this.recognitionCooldownMs = 8000; // 8 seconds cooldown per student for notifications
    this.distanceThreshold = 0.52; // Lower = stricter, Higher = looser (0.5 - 0.55 is standard)
    this.onStudentDetected = null; // Callback: ({ student, confidence, distance }) => {}
    this.onFaceStatus = null; // Callback: (statusText) => {}
    this.audioCtx = null;
  }

  /**
   * Load face-api.js neural network models (TinyFaceDetector, FaceLandmarks, FaceRecognition)
   */
  async loadModels(statusCallback) {
    if (this.isModelsLoaded) return true;
    if (this.isLoadingModels) return;

    this.isLoadingModels = true;
    const update = (msg) => {
      console.log('[FaceService]', msg);
      if (statusCallback) statusCallback(msg);
      if (this.onFaceStatus) this.onFaceStatus(msg);
    };

    try {
      update('Loading biometric models...');
      const modelPaths = ['./models', 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/'];

      let loaded = false;
      for (const p of modelPaths) {
        try {
          update(`Loading neural networks from ${p.startsWith('.') ? 'local storage' : 'CDN'}...`);
          await faceapi.nets.tinyFaceDetector.loadFromUri(p);
          await faceapi.nets.faceLandmark68Net.loadFromUri(p);
          await faceapi.nets.faceRecognitionNet.loadFromUri(p);
          loaded = true;
          console.log('[FaceService] Models loaded successfully from', p);
          break;
        } catch (err) {
          console.warn('[FaceService] Failed to load models from', p, err);
        }
      }

      if (!loaded) {
        throw new Error('Could not load face recognition neural network models. Check internet or local models directory.');
      }

      this.isModelsLoaded = true;
      this.isLoadingModels = false;
      update('Biometric AI ready');
      return true;
    } catch (e) {
      this.isLoadingModels = false;
      update('Model loading error: ' + e.message);
      throw e;
    }
  }

  /**
   * Refresh in-memory list of enrolled student descriptors for fast Euclidean comparison
   */
  async syncStudentDescriptors(students) {
    this.labeledDescriptors = [];
    if (!students || !students.length) return;

    students.forEach((s) => {
      if (s.descriptor && Array.isArray(s.descriptor) && s.descriptor.length === 128) {
        this.labeledDescriptors.push({
          id: s.id,
          name: s.name,
          rollNo: s.rollNo || s.id,
          department: s.department || '',
          photo: s.photo || '',
          descriptor: new Float32Array(s.descriptor)
        });
      }
    });
    console.log(`[FaceService] Synced ${this.labeledDescriptors.length} enrolled student face descriptors.`);
  }

  /**
   * Start webcam video stream
   */
  async startCamera(videoEl, canvasEl, deviceId = null) {
    this.videoElement = videoEl;
    this.canvasElement = canvasEl;

    if (this.stream) {
      this.stopCamera();
    }

    const constraints = {
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode: 'user',
        deviceId: deviceId ? { exact: deviceId } : undefined
      },
      audio: false
    };

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.videoElement.srcObject = this.stream;
      await new Promise((resolve) => {
        this.videoElement.onloadedmetadata = () => {
          this.videoElement.play();
          resolve();
        };
      });
      return true;
    } catch (err) {
      console.error('[FaceService] Camera access error:', err);
      let errorMsg = 'Failed to access camera. Please allow webcam permissions in Chrome.';
      if (err.name === 'NotAllowedError') {
        errorMsg = 'Webcam permission denied. Please click the camera icon in Chrome address bar to allow camera access.';
      } else if (err.name === 'NotFoundError') {
        errorMsg = 'No webcam or camera device detected on your system.';
      }
      throw new Error(errorMsg);
    }
  }

  /**
   * Stop camera stream
   */
  stopCamera() {
    this.stopScanning();
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.videoElement) {
      this.videoElement.srcObject = null;
    }
    if (this.canvasElement) {
      const ctx = this.canvasElement.getContext('2d');
      ctx.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
    }
  }

  /**
   * List available camera devices
   */
  async getCameraDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter(d => d.kind === 'videoinput');
    } catch (e) {
      return [];
    }
  }

  /**
   * Start real-time attendance face scanning loop
   */
  startScanning(onDetectedCallback) {
    if (this.isScanning) return;
    this.isScanning = true;
    this.onStudentDetected = onDetectedCallback;

    const processFrame = async () => {
      if (!this.isScanning || !this.videoElement || !this.canvasElement) return;

      if (this.videoElement.readyState === 4 && !this.videoElement.paused) {
        try {
          await this._detectAndMatchFaces();
        } catch (e) {
          console.warn('[FaceService] Frame scan error:', e);
        }
      }

      if (this.isScanning) {
        // Run scan at ~3-4 frames per second to keep CPU low and smooth
        this.scanIntervalId = setTimeout(() => {
          requestAnimationFrame(processFrame);
        }, 250);
      }
    };

    processFrame();
  }

  stopScanning() {
    this.isScanning = false;
    if (this.scanIntervalId) {
      clearTimeout(this.scanIntervalId);
      this.scanIntervalId = null;
    }
    if (this.canvasElement) {
      const ctx = this.canvasElement.getContext('2d');
      ctx.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
    }
  }

  /**
   * Real-time detection & recognition algorithm
   */
  async _detectAndMatchFaces() {
    const video = this.videoElement;
    const canvas = this.canvasElement;
    if (!video || !canvas || video.videoWidth === 0) return;

    // Synchronize canvas size with video display dimensions
    const displaySize = { width: video.videoWidth, height: video.videoHeight };
    faceapi.matchDimensions(canvas, displaySize);

    // Detect all faces in current frame with landmarks & descriptors
    const options = faceapi.TinyFaceDetectorOptions
      ? new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 })
      : (faceapi.SsdMobilenetv1Options ? new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }) : undefined);

    const detections = await faceapi
      .detectAllFaces(video, options)
      .withFaceLandmarks()
      .withFaceDescriptors();

    const resizedDetections = faceapi.resizeResults(detections, displaySize);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (resizedDetections.length === 0) {
      if (this.onFaceStatus) this.onFaceStatus('Position face inside camera frame');
      return;
    }

    const now = Date.now();

    for (const detection of resizedDetections) {
      const box = detection.detection.box;
      const descriptor = detection.descriptor;

      // Find nearest enrolled student using Euclidean distance
      let bestMatch = null;
      let minDistance = 1.0;

      for (const enrolled of this.labeledDescriptors) {
        const dist = this._euclideanDistance(descriptor, enrolled.descriptor);
        if (dist < minDistance) {
          minDistance = dist;
          bestMatch = enrolled;
        }
      }

      const isMatch = bestMatch && minDistance <= this.distanceThreshold;
      const confidence = isMatch ? Math.max(50, Math.round((1 - (minDistance / this.distanceThreshold) * 0.5) * 100)) : 0;

      // Draw futuristic bounding box
      this._drawDetectionBox(ctx, box, isMatch ? bestMatch.name : 'Unknown Student', isMatch, confidence);

      if (isMatch) {
        const lastNotified = this.lastRecognizedTime[bestMatch.id] || 0;
        const cooldownActive = (now - lastNotified) < this.recognitionCooldownMs;

        if (!cooldownActive) {
          this.lastRecognizedTime[bestMatch.id] = now;
          this.playBeepSound();

          if (this.onStudentDetected) {
            this.onStudentDetected({
              student: bestMatch,
              confidence,
              distance: Number(minDistance.toFixed(3)),
              timestamp: now
            });
          }
        }
      }
    }
  }

  /**
   * Extract face descriptor and thumbnail from an image element or video frame
   * (Used during Student Registration / Enrollment)
   */
  async extractFaceFromElement(mediaElement) {
    if (!this.isModelsLoaded) {
      await this.loadModels();
    }

    const options = faceapi.TinyFaceDetectorOptions
      ? new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 })
      : (faceapi.SsdMobilenetv1Options ? new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }) : undefined);

    const detection = await faceapi
      .detectSingleFace(mediaElement, options)
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!detection) {
      throw new Error('No face detected. Please face the camera directly with good lighting.');
    }

    // Generate high quality cropped face thumbnail
    const thumbnailDataUrl = this._extractThumbnail(mediaElement, detection.detection.box);

    return {
      descriptor: Array.from(detection.descriptor), // Convert Float32Array to plain array for JSON storage
      box: detection.detection.box,
      score: Math.round(detection.detection.score * 100),
      thumbnail: thumbnailDataUrl
    };
  }

  /**
   * Euclidean distance between two 128-dimensional vectors
   */
  _euclideanDistance(vec1, vec2) {
    let sum = 0;
    for (let i = 0; i < 128; i++) {
      const diff = vec1[i] - vec2[i];
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }

  /**
   * Crop face bounding box to create an avatar thumbnail data URL
   */
  _extractThumbnail(mediaElement, box) {
    const pad = 30; // padding around face
    const sourceX = Math.max(0, box.x - pad);
    const sourceY = Math.max(0, box.y - pad);
    const sourceW = Math.min(mediaElement.width || mediaElement.videoWidth, box.width + pad * 2);
    const sourceH = Math.min(mediaElement.height || mediaElement.videoHeight, box.height + pad * 2);

    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 160;
    const ctx = canvas.getContext('2d');

    // Round avatar styling
    ctx.beginPath();
    ctx.arc(80, 80, 80, 0, Math.PI * 2, true);
    ctx.closePath();
    ctx.clip();

    ctx.drawImage(mediaElement, sourceX, sourceY, sourceW, sourceH, 0, 0, 160, 160);
    return canvas.toDataURL('image/jpeg', 0.85);
  }

  /**
   * Draw glowing futuristic biometric bounding box with corner reticles
   */
  _drawDetectionBox(ctx, box, label, isMatch, confidence) {
    const { x, y, width, height } = box;
    const strokeColor = isMatch ? '#10b981' : '#f43f5e'; // Green for match, Red for unknown
    const bgColor = isMatch ? 'rgba(16, 185, 129, 0.15)' : 'rgba(244, 63, 94, 0.1)';

    ctx.save();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2.5;

    // Semi-transparent box fill
    ctx.fillStyle = bgColor;
    ctx.fillRect(x, y, width, height);

    // Corner brackets styling (biometric HUD style)
    const lineLen = Math.min(25, width / 4);
    ctx.beginPath();
    // Top-left
    ctx.moveTo(x, y + lineLen); ctx.lineTo(x, y); ctx.lineTo(x + lineLen, y);
    // Top-right
    ctx.moveTo(x + width - lineLen, y); ctx.lineTo(x + width, y); ctx.lineTo(x + width, y + lineLen);
    // Bottom-right
    ctx.moveTo(x + width, y + height - lineLen); ctx.lineTo(x + width, y + height); ctx.lineTo(x + width - lineLen, y + height);
    // Bottom-left
    ctx.moveTo(x + lineLen, y + height); ctx.lineTo(x, y + height); ctx.lineTo(x, y + height - lineLen);
    ctx.stroke();

    // Badge label at top
    const text = isMatch ? `${label} (${confidence}%)` : 'Unknown Face';
    ctx.font = '600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    const textWidth = ctx.measureText(text).width;
    const badgeHeight = 24;
    const badgeY = Math.max(0, y - badgeHeight - 4);

    // Badge background
    ctx.fillStyle = strokeColor;
    ctx.beginPath();
    ctx.roundRect(x, badgeY, textWidth + 16, badgeHeight, 6);
    ctx.fill();

    // Badge text
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, x + 8, badgeY + 16);

    ctx.restore();
  }

  /**
   * Web Audio API Chime for instant feedback
   */
  playBeepSound() {
    try {
      if (!this.audioCtx) {
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }

      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, this.audioCtx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, this.audioCtx.currentTime + 0.12); // A5

      gain.gain.setValueAtTime(0.25, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.28);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start();
      osc.stop(this.audioCtx.currentTime + 0.28);
    } catch (e) {
      console.warn('Audio playback error', e);
    }
  }
}

window.faceService = new FaceService();
