/**
 * OnliAttend - Main Application Controller
 * Coordinates navigation, camera scanning, student enrollment, daily registers,
 * and PWA lifecycle.
 */

class OnliAttendApp {
  constructor() {
    this.currentTab = 'scan';
    this.selectedDate = attendanceStorage.formatDate(new Date());
    this.enrollmentStream = null;
    this.enrollmentFaceData = null; // Captured descriptor & thumbnail
    this.deferredPrompt = null;
  }

  async init() {
    console.log('[OnliAttend] Initializing application...');

    // 1. Initialize DB storage
    await attendanceStorage.init();

    // 2. Setup navigation tabs
    this._setupNavigation();

    // 3. Setup PWA install banner
    this._setupPwaInstall();

    // 4. Setup Scanner controls
    this._setupScanner();

    // 5. Setup Student Enrollment & Management
    this._setupStudents();

    // 6. Setup Analytics & Starting Date Calendar
    this._setupAnalytics();

    // 7. Setup Daily Sheet
    this._setupDailySheet();

    // 8. Setup Settings & Demo Data
    this._setupSettings();

    // 9. Load AI Models in background & sync student descriptors
    this._loadAiModels();

    // 10. Check if students exist, if not show welcome hint
    const students = await attendanceStorage.getAllStudents();
    if (students.length === 0) {
      this._showWelcomeModal();
    }

    console.log('[OniAttendance] Initialization complete.');
  }

  // --- NAVIGATION ---

  _setupNavigation() {
    const navButtons = document.querySelectorAll('[data-tab-target]');
    navButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const targetTab = btn.getAttribute('data-tab-target');
        this.switchTab(targetTab);
      });
    });
  }

  switchTab(tabId) {
    this.currentTab = tabId;

    // Update nav button active states
    document.querySelectorAll('[data-tab-target]').forEach(b => {
      if (b.getAttribute('data-tab-target') === tabId) {
        b.classList.add('nav-item-active');
      } else {
        b.classList.remove('nav-item-active');
      }
    });

    // Update section visibility
    document.querySelectorAll('.app-section').forEach(sec => {
      if (sec.id === `section-${tabId}`) {
        sec.classList.remove('hidden');
      } else {
        sec.classList.add('hidden');
      }
    });

    // Tab-specific lifecycle hooks
    if (tabId === 'scan') {
      // Auto-start camera if previously allowed or active
      this.refreshRecentScans();
    } else {
      // Stop scanner loop when navigating away to save battery
      faceService.stopScanning();
      const statusPill = document.getElementById('cameraStatusPill');
      if (statusPill) statusPill.textContent = 'Camera Standby';
    }

    if (tabId === 'students') {
      this.renderStudentsList();
    }

    if (tabId === 'analytics') {
      chartsManager.renderDashboard();
    }

    if (tabId === 'daily') {
      this.renderDailySheet();
    }
  }

  // --- PWA INSTALLATION ---

  _setupPwaInstall() {
    const installBtn = document.getElementById('pwaInstallBtn');

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPrompt = e;
      if (installBtn) {
        installBtn.classList.remove('hidden');
        installBtn.addEventListener('click', async () => {
          if (this.deferredPrompt) {
            this.deferredPrompt.prompt();
            const { outcome } = await this.deferredPrompt.userChoice;
            console.log(`User ${outcome} the PWA install`);
            this.deferredPrompt = null;
            installBtn.classList.add('hidden');
          }
        });
      }
    });

    // Register service worker if available
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').then(reg => {
        console.log('[OnliAttend] ServiceWorker registered', reg.scope);
      }).catch(err => {
        console.log('[OnliAttend] ServiceWorker registration skipped:', err);
      });
    }
  }

  // --- AI MODELS LOADING ---

  async _loadAiModels() {
    const statusText = document.getElementById('scannerModelStatus');
    const loadingBadge = document.getElementById('modelLoadingBadge');

    try {
      if (loadingBadge) loadingBadge.classList.remove('hidden');
      await faceService.loadModels((msg) => {
        if (statusText) statusText.textContent = msg;
      });

      // Synchronize enrolled student face descriptors
      const students = await attendanceStorage.getAllStudents();
      await faceService.syncStudentDescriptors(students);

      if (loadingBadge) loadingBadge.classList.add('hidden');
      if (statusText) statusText.textContent = 'Biometric Engine Ready';
    } catch (err) {
      if (statusText) statusText.textContent = 'AI Model Error: ' + err.message;
      if (loadingBadge) loadingBadge.classList.add('hidden');
    }
  }

  // --- SCANNER VIEW (LIVE ATTENDANCE) ---

  _setupScanner() {
    const video = document.getElementById('scannerVideo');
    const canvas = document.getElementById('scannerCanvas');
    const toggleCameraBtn = document.getElementById('btnToggleCamera');
    const cameraSelect = document.getElementById('cameraDeviceSelect');

    let cameraRunning = false;

    // Camera device dropdown
    faceService.getCameraDevices().then(devices => {
      if (cameraSelect && devices.length > 0) {
        cameraSelect.innerHTML = devices.map(d => `<option value="${d.deviceId}">${d.label || 'Webcam ' + (devices.indexOf(d) + 1)}</option>`).join('');
      }
    });

    if (toggleCameraBtn) {
      toggleCameraBtn.addEventListener('click', async () => {
        if (!cameraRunning) {
          try {
            toggleCameraBtn.innerHTML = `<span>⏳ Starting...</span>`;
            const deviceId = cameraSelect ? cameraSelect.value : null;
            await faceService.startCamera(video, canvas, deviceId);
            cameraRunning = true;
            toggleCameraBtn.innerHTML = `<span>⏹ Stop Camera</span>`;
            toggleCameraBtn.classList.add('btn-danger');

            document.getElementById('cameraStatusPill').textContent = 'Camera Active (Scanning)';
            document.getElementById('cameraStatusPill').className = 'status-pill status-pill-active';

            // Start scanning faces
            faceService.startScanning((result) => {
              this._onFaceDetected(result);
            });
          } catch (err) {
            toggleCameraBtn.innerHTML = `<span>▶ Start Camera</span>`;
            toggleCameraBtn.classList.remove('btn-danger');
            this.showToast(err.message, 'error');
          }
        } else {
          faceService.stopCamera();
          cameraRunning = false;
          toggleCameraBtn.innerHTML = `<span>▶ Start Camera</span>`;
          toggleCameraBtn.classList.remove('btn-danger');
          document.getElementById('cameraStatusPill').textContent = 'Camera Off';
          document.getElementById('cameraStatusPill').className = 'status-pill';
        }
      });
    }

    this.refreshRecentScans();
  }

  async _onFaceDetected({ student, confidence, distance }) {
    const todayStr = attendanceStorage.formatDate(new Date());
    const existingRecords = await attendanceStorage.getAttendanceForDate(todayStr);
    const existing = existingRecords.find(r => r.studentId === student.id && r.status === 'present');

    if (existing) {
      // Already marked today
      this._showScanBanner(student, confidence, `Already marked present at ${existing.time}`, false);
      return;
    }

    // Mark student present!
    const timeStr = attendanceStorage.formatTime(new Date());
    await attendanceStorage.markAttendance({
      studentId: student.id,
      studentName: student.name,
      date: todayStr,
      time: timeStr,
      status: 'present',
      method: 'camera_scan',
      confidence
    });

    this._showScanBanner(student, confidence, `Marked Present at ${timeStr}!`, true);
    this.refreshRecentScans();
  }

  _showScanBanner(student, confidence, message, isNew) {
    const banner = document.getElementById('scanResultBanner');
    if (!banner) return;

    banner.innerHTML = `
      <div class="scan-alert-card ${isNew ? 'scan-alert-success' : 'scan-alert-info'}">
        <img src="${student.photo || 'icons/icon-192.png'}" class="scan-alert-avatar" alt="${student.name}" />
        <div class="scan-alert-content">
          <div class="scan-alert-title">${student.name} <span class="badge ${isNew ? 'badge-success' : 'badge-neutral'}">${confidence}% Match</span></div>
          <div class="scan-alert-sub">${student.rollNo} • ${student.department || 'Enrolled Student'}</div>
          <div class="scan-alert-message">${message}</div>
        </div>
      </div>
    `;

    banner.classList.remove('hidden');
    banner.classList.add('banner-slide-in');

    // Auto-hide after 5 seconds
    setTimeout(() => {
      banner.classList.add('hidden');
    }, 5000);
  }

  async refreshRecentScans() {
    const container = document.getElementById('recentScansList');
    if (!container) return;

    const todayStr = attendanceStorage.formatDate(new Date());
    const records = await attendanceStorage.getAttendanceForDate(todayStr);
    const presents = records.filter(r => r.status === 'present').reverse();

    const countEl = document.getElementById('todayPresentCount');
    if (countEl) countEl.textContent = presents.length;

    if (presents.length === 0) {
      container.innerHTML = `<div class="empty-state text-muted">No attendance marked yet today. Start camera to scan faces.</div>`;
      return;
    }

    container.innerHTML = presents.slice(0, 8).map(r => `
      <div class="recent-scan-item">
        <div class="recent-scan-info">
          <div class="font-medium text-white">${r.studentName}</div>
          <div class="text-xs text-muted">${r.studentId} • ${r.time} • ${r.confidence ? r.confidence + '% match' : 'Manual'}</div>
        </div>
        <span class="badge badge-success">Present</span>
      </div>
    `).join('');
  }

  // --- STUDENT ENROLLMENT (FACE ID) ---

  _setupStudents() {
    const modal = document.getElementById('enrollStudentModal');
    const openBtn = document.getElementById('btnOpenEnrollModal');
    const closeBtn = document.getElementById('btnCloseEnrollModal');
    const form = document.getElementById('enrollStudentForm');

    const enrollVideo = document.getElementById('enrollVideo');
    const btnCaptureFace = document.getElementById('btnCaptureFace');
    const faceUploadInput = document.getElementById('enrollPhotoInput');
    const facePreview = document.getElementById('enrollFacePreview');
    const faceStatus = document.getElementById('enrollFaceStatus');

    if (openBtn) {
      openBtn.addEventListener('click', async () => {
        form.reset();
        this.enrollmentFaceData = null;
        if (facePreview) facePreview.src = 'icons/icon-192.png';
        if (faceStatus) faceStatus.innerHTML = '<span class="text-muted">Align face inside camera and click "Capture Face"</span>';
        modal.classList.remove('hidden');

        // Start webcam for enrollment capture
        try {
          this.enrollmentStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 480 }, height: { ideal: 480 }, facingMode: 'user' }
          });
          enrollVideo.srcObject = this.enrollmentStream;
          enrollVideo.play();
        } catch (e) {
          console.warn('Enrollment camera error', e);
          if (faceStatus) faceStatus.innerHTML = '<span class="text-rose">Camera not accessible. You can upload a photo below.</span>';
        }
      });
    }

    const closeEnrollment = () => {
      if (this.enrollmentStream) {
        this.enrollmentStream.getTracks().forEach(t => t.stop());
        this.enrollmentStream = null;
      }
      modal.classList.add('hidden');
    };

    if (closeBtn) closeBtn.addEventListener('click', closeEnrollment);

    // Capture Face from webcam
    if (btnCaptureFace) {
      btnCaptureFace.addEventListener('click', async () => {
        if (!enrollVideo.videoWidth) {
          this.showToast('Please wait for webcam feed to activate.', 'warning');
          return;
        }

        try {
          btnCaptureFace.disabled = true;
          faceStatus.innerHTML = '<span class="text-amber">⏳ Analyzing face biometrics...</span>';

          const result = await faceService.extractFaceFromElement(enrollVideo);
          this.enrollmentFaceData = result;

          facePreview.src = result.thumbnail;
          faceStatus.innerHTML = `<span class="text-emerald">✓ Face ID captured (${result.score}% quality score)</span>`;
          this.showToast('Face ID captured successfully!', 'success');
        } catch (err) {
          faceStatus.innerHTML = `<span class="text-rose">⚠️ ${err.message}</span>`;
          this.showToast(err.message, 'error');
        } finally {
          btnCaptureFace.disabled = false;
        }
      });
    }

    // Photo file upload alternative
    if (faceUploadInput) {
      faceUploadInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const img = new Image();
        img.onload = async () => {
          try {
            faceStatus.innerHTML = '<span class="text-amber">⏳ Analyzing uploaded photo...</span>';
            const result = await faceService.extractFaceFromElement(img);
            this.enrollmentFaceData = result;
            facePreview.src = result.thumbnail;
            faceStatus.innerHTML = `<span class="text-emerald">✓ Face ID extracted from photo!</span>`;
            this.showToast('Face ID extracted from photo!', 'success');
          } catch (err) {
            faceStatus.innerHTML = `<span class="text-rose">⚠️ ${err.message}</span>`;
            this.showToast(err.message, 'error');
          }
        };
        img.src = URL.createObjectURL(file);
      });
    }

    // Form submission
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('enrollStudentId').value.trim();
        const name = document.getElementById('enrollStudentName').value.trim();
        const department = document.getElementById('enrollDepartment').value.trim();
        const email = document.getElementById('enrollEmail').value.trim();

        if (!id || !name) {
          this.showToast('Student ID and Name are required.', 'error');
          return;
        }

        if (!this.enrollmentFaceData) {
          this.showToast('Please capture or upload the student’s face ID first.', 'warning');
          return;
        }

        const student = {
          id,
          name,
          rollNo: id,
          department: department || 'General',
          email,
          photo: this.enrollmentFaceData.thumbnail,
          descriptor: this.enrollmentFaceData.descriptor
        };

        try {
          await attendanceStorage.saveStudent(student);
          // Sync with face recognizer
          const allStudents = await attendanceStorage.getAllStudents();
          await faceService.syncStudentDescriptors(allStudents);

          this.showToast(`Student ${name} enrolled with Face ID!`, 'success');
          closeEnrollment();
          this.renderStudentsList();
        } catch (err) {
          this.showToast('Save failed: ' + err.message, 'error');
        }
      });
    }

    // Student Search filter
    const searchInput = document.getElementById('studentSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        this.renderStudentsList(searchInput.value);
      });
    }
  }

  async renderStudentsList(query = '') {
    const container = document.getElementById('studentsGrid');
    if (!container) return;

    let students = await attendanceStorage.getAllStudents();
    const countBadge = document.getElementById('enrolledStudentsCount');
    if (countBadge) countBadge.textContent = `${students.length} Enrolled`;

    if (query) {
      const q = query.toLowerCase();
      students = students.filter(s => s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q) || (s.department && s.department.toLowerCase().includes(q)));
    }

    if (students.length === 0) {
      container.innerHTML = `
        <div class="col-span-full empty-state py-12">
          <div class="empty-state-icon">👥</div>
          <div class="text-lg font-semibold text-white mt-2">No Students Found</div>
          <div class="text-sm text-muted mt-1">Enroll your first student with Face ID, or load demo sample data in Settings.</div>
          <button class="btn btn-primary mt-4" id="emptyAddBtn">Enroll First Student</button>
        </div>
      `;
      const emptyAdd = document.getElementById('emptyAddBtn');
      if (emptyAdd) {
        emptyAdd.addEventListener('click', () => {
          document.getElementById('btnOpenEnrollModal')?.click();
        });
      }
      return;
    }

    container.innerHTML = students.map(s => `
      <div class="card student-card">
        <div class="student-card-header">
          <img src="${s.photo || 'icons/icon-192.png'}" class="student-card-avatar" alt="${s.name}" />
          <div class="student-card-meta">
            <h3 class="student-name">${s.name}</h3>
            <div class="student-id">${s.rollNo || s.id}</div>
            <div class="student-dept">${s.department || 'Student'}</div>
          </div>
        </div>
        <div class="student-card-footer">
          <span class="badge ${s.descriptor ? 'badge-success' : 'badge-neutral'}">
            ${s.descriptor ? '✓ Face ID Enrolled' : 'No Biometrics'}
          </span>
          <button class="btn-icon btn-danger-ghost delete-student-btn" data-id="${s.id}" title="Delete Student">
            🗑️
          </button>
        </div>
      </div>
    `).join('');

    // Attach delete listeners
    container.querySelectorAll('.delete-student-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = btn.getAttribute('data-id');
        if (confirm(`Are you sure you want to remove student ${id}? This will also delete their attendance history.`)) {
          await attendanceStorage.deleteStudent(id);
          const all = await attendanceStorage.getAllStudents();
          await faceService.syncStudentDescriptors(all);
          this.showToast('Student removed.', 'info');
          this.renderStudentsList();
        }
      });
    });
  }

  // --- ANALYTICS & STARTING DATE CALENDAR ---

  async _setupAnalytics() {
    const calendarInput = document.getElementById('calendarStartingDate');
    const applyBtn = document.getElementById('btnApplyCalendarDate');
    const presetButtons = document.querySelectorAll('[data-preset-days]');
    const exportCsvBtn = document.getElementById('btnExportCsv');

    // Load saved or default starting date
    const savedStartDate = await attendanceStorage.getSetting('starting_date');
    if (savedStartDate) {
      calendarInput.value = savedStartDate;
      chartsManager.startDate = savedStartDate;
    } else {
      // Default: 14 days ago
      const d = new Date();
      d.setDate(d.getDate() - 14);
      const defaultStr = attendanceStorage.formatDate(d);
      calendarInput.value = defaultStr;
      chartsManager.startDate = defaultStr;
    }

    if (applyBtn) {
      applyBtn.addEventListener('click', async () => {
        const chosenDate = calendarInput.value;
        if (!chosenDate) {
          this.showToast('Please pick a starting date in the calendar.', 'warning');
          return;
        }
        await chartsManager.updateDateRange(chosenDate);
        this.showToast(`Attendance calculated from ${chosenDate}`, 'success');
      });
    }

    // Preset chips (7d, 14d, 30d, etc.)
    presetButtons.forEach(btn => {
      btn.addEventListener('click', async () => {
        presetButtons.forEach(b => b.classList.remove('btn-chip-active'));
        btn.classList.add('btn-chip-active');

        const days = parseInt(btn.getAttribute('data-preset-days'), 10);
        const d = new Date();
        d.setDate(d.getDate() - days);
        const dateStr = attendanceStorage.formatDate(d);
        calendarInput.value = dateStr;
        await chartsManager.updateDateRange(dateStr);
      });
    });

    // CSV Export for NTCC Report
    if (exportCsvBtn) {
      exportCsvBtn.addEventListener('click', async () => {
        await this._exportAttendanceCsv();
      });
    }
  }

  async _exportAttendanceCsv() {
    const stats = await chartsManager.computeStatistics();
    if (!stats.studentStats || stats.studentStats.length === 0) {
      this.showToast('No attendance data available to export.', 'warning');
      return;
    }

    let csv = `NTCC Project: OnliAttend - Student Attendance Summary Report\n`;
    csv += `Period: ${stats.startDate} to ${stats.endDate} (${stats.totalWorkingDays} Working Days)\n\n`;
    csv += `Student ID,Student Name,Department,Days Present,Days Absent,Attendance Percentage,Eligibility Status\n`;

    stats.studentStats.forEach(s => {
      const status = s.isShortage ? 'Shortage (<75%)' : 'Eligible (>=75%)';
      csv += `"${s.rollNo}","${s.name}","${s.department}",${s.daysPresent},${s.daysAbsent},"${s.percentage}%","${status}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `onliattend_report_${stats.startDate}_to_${stats.endDate}.csv`;
    link.click();
    this.showToast('CSV Report downloaded successfully!', 'success');
  }

  // --- DAILY SHEET VIEW ---

  _setupDailySheet() {
    const dateInput = document.getElementById('dailySheetDate');
    const prevDayBtn = document.getElementById('btnPrevDay');
    const nextDayBtn = document.getElementById('btnNextDay');
    const markAllPresentBtn = document.getElementById('btnMarkAllPresent');
    const clearDayBtn = document.getElementById('btnClearDay');

    dateInput.value = this.selectedDate;

    dateInput.addEventListener('change', () => {
      this.selectedDate = dateInput.value;
      this.renderDailySheet();
    });

    if (prevDayBtn) {
      prevDayBtn.addEventListener('click', () => {
        const d = new Date(this.selectedDate);
        d.setDate(d.getDate() - 1);
        this.selectedDate = attendanceStorage.formatDate(d);
        dateInput.value = this.selectedDate;
        this.renderDailySheet();
      });
    }

    if (nextDayBtn) {
      nextDayBtn.addEventListener('click', () => {
        const d = new Date(this.selectedDate);
        d.setDate(d.getDate() + 1);
        this.selectedDate = attendanceStorage.formatDate(d);
        dateInput.value = this.selectedDate;
        this.renderDailySheet();
      });
    }

    if (markAllPresentBtn) {
      markAllPresentBtn.addEventListener('click', async () => {
        const students = await attendanceStorage.getAllStudents();
        for (const s of students) {
          await attendanceStorage.markAttendance({
            studentId: s.id,
            studentName: s.name,
            date: this.selectedDate,
            status: 'present',
            method: 'manual',
            notes: 'Bulk marked present'
          });
        }
        this.showToast('All students marked present for ' + this.selectedDate, 'success');
        this.renderDailySheet();
        if (this.currentTab === 'analytics') chartsManager.renderDashboard();
      });
    }

    if (clearDayBtn) {
      clearDayBtn.addEventListener('click', async () => {
        if (confirm(`Clear all attendance records for ${this.selectedDate}?`)) {
          const students = await attendanceStorage.getAllStudents();
          for (const s of students) {
            await attendanceStorage.markAttendance({
              studentId: s.id,
              studentName: s.name,
              date: this.selectedDate,
              status: 'absent',
              method: 'manual',
              notes: 'Reset'
            });
          }
          this.showToast('Cleared attendance for ' + this.selectedDate, 'info');
          this.renderDailySheet();
        }
      });
    }
  }

  async renderDailySheet() {
    const tbody = document.getElementById('dailySheetTableBody');
    if (!tbody) return;

    const students = await attendanceStorage.getAllStudents();
    const records = await attendanceStorage.getAttendanceForDate(this.selectedDate);
    const recordMap = new Map();
    records.forEach(r => recordMap.set(r.studentId, r));

    if (students.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-8">No students enrolled yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = students.map(s => {
      const rec = recordMap.get(s.id);
      const isPresent = rec && rec.status === 'present';
      const timeStr = isPresent && rec.time ? rec.time : '—';
      const methodStr = isPresent
        ? (rec.method === 'camera_scan' ? '📷 Face ID Scan' : '✍️ Manual')
        : '—';

      return `
        <tr>
          <td>
            <div class="user-cell">
              <img src="${s.photo || 'icons/icon-192.png'}" class="user-avatar-sm" alt="${s.name}" />
              <div>
                <div class="font-medium text-white">${s.name}</div>
                <div class="text-xs text-muted">${s.rollNo}</div>
              </div>
            </div>
          </td>
          <td>${s.department || 'General'}</td>
          <td>${timeStr}</td>
          <td>${methodStr}</td>
          <td>
            <button class="btn btn-sm ${isPresent ? 'btn-success' : 'btn-outline-danger'} toggle-attendance-btn" data-id="${s.id}">
              ${isPresent ? '✓ Present' : '✗ Absent'}
            </button>
          </td>
        </tr>
      `;
    }).join('');

    // Toggle button listeners
    tbody.querySelectorAll('.toggle-attendance-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        await attendanceStorage.toggleStudentAttendance(id, this.selectedDate);
        this.renderDailySheet();
        this.refreshRecentScans();
      });
    });
  }

  // --- SETTINGS & DEMO DATA ---

  _setupSettings() {
    const seedBtn = document.getElementById('btnSeedDemoData');
    const clearBtn = document.getElementById('btnClearAllData');
    const thresholdSlider = document.getElementById('matchThresholdSlider');
    const thresholdValueLabel = document.getElementById('matchThresholdVal');

    if (thresholdSlider) {
      thresholdSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        faceService.distanceThreshold = val;
        if (thresholdValueLabel) thresholdValueLabel.textContent = val.toFixed(2);
      });
    }

    if (seedBtn) {
      seedBtn.addEventListener('click', async () => {
        if (confirm('Load demo students and 21 days of attendance data for NTCC presentation?')) {
          seedBtn.disabled = true;
          seedBtn.innerHTML = '<span>⏳ Seeding Demo Data...</span>';
          try {
            const res = await attendanceStorage.seedDemoData();
            const all = await attendanceStorage.getAllStudents();
            await faceService.syncStudentDescriptors(all);

            this.showToast(`Loaded ${res.studentsCount} students and daily attendance since ${res.startDate}!`, 'success');
            // Switch to analytics tab to show off charts immediately
            this.switchTab('analytics');
          } catch (e) {
            this.showToast('Seed failed: ' + e.message, 'error');
          } finally {
            seedBtn.disabled = false;
            seedBtn.innerHTML = '<span>⚡ Load Demo Students & 3-Week Attendance Data</span>';
          }
        }
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        if (confirm('Are you sure you want to clear ALL students and attendance records? This cannot be undone.')) {
          await attendanceStorage.clearAllData();
          await faceService.syncStudentDescriptors([]);
          this.showToast('All data has been reset.', 'info');
          this.switchTab('students');
        }
      });
    }
  }

  // --- TOAST NOTIFICATIONS ---

  showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type} toast-enter`;
    toast.innerHTML = `
      <div class="toast-content">${message}</div>
    `;

    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast-leave');
      setTimeout(() => toast.remove(), 300);
    }, 3800);
  }

  _showWelcomeModal() {
    const modal = document.getElementById('welcomeGuideModal');
    if (modal) {
      modal.classList.remove('hidden');
      document.getElementById('btnCloseWelcomeGuide')?.addEventListener('click', () => {
        modal.classList.add('hidden');
      });
      document.getElementById('btnWelcomeSeedDemo')?.addEventListener('click', async () => {
        modal.classList.add('hidden');
        document.getElementById('btnSeedDemoData')?.click();
      });
    }
  }
}

window.onliApp = new OnliAttendApp();
window.oniApp = window.onliApp; // Alias for compatibility
document.addEventListener('DOMContentLoaded', () => {
  window.onliApp.init();
});
