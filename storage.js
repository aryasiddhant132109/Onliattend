/**
 * OniAttendance - Storage Engine
 * Manages students, biometric descriptors, attendance records, and app settings
 * using IndexedDB with reliable LocalStorage fallback.
 */

class AttendanceStorage {
  constructor() {
    this.dbName = 'OniAttendanceDB';
    this.dbVersion = 1;
    this.db = null;
    this.isReady = false;
  }

  async init() {
    if (this.isReady) return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Students store: keyed by unique student roll number / id
        if (!db.objectStoreNames.contains('students')) {
          const studentStore = db.createObjectStore('students', { keyPath: 'id' });
          studentStore.createIndex('name', 'name', { unique: false });
          studentStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        // Attendance records: keyed by composite key (date + '_' + studentId)
        if (!db.objectStoreNames.contains('attendance')) {
          const attendanceStore = db.createObjectStore('attendance', { keyPath: 'recordId' });
          attendanceStore.createIndex('date', 'date', { unique: false });
          attendanceStore.createIndex('studentId', 'studentId', { unique: false });
          attendanceStore.createIndex('status', 'status', { unique: false });
        }

        // Settings store
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        this.isReady = true;
        resolve();
      };

      request.onerror = (event) => {
        console.warn('IndexedDB error, falling back to LocalStorage', event.target.error);
        this.isReady = true; // Still allow app to function via localStorage fallback
        resolve();
      };
    });
  }

  // --- STUDENT METHODS ---

  async saveStudent(student) {
    await this.init();
    if (!student.id || !student.name) {
      throw new Error('Student ID and Name are required.');
    }

    const payload = {
      ...student,
      updatedAt: new Date().toISOString()
    };
    if (!payload.createdAt) {
      payload.createdAt = new Date().toISOString();
    }

    if (this.db) {
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(['students'], 'readwrite');
        const store = tx.objectStore('students');
        const req = store.put(payload);
        req.onsuccess = () => resolve(payload);
        req.onerror = (e) => reject(e.target.error);
      });
    } else {
      const all = this._lsGet('students', []);
      const idx = all.findIndex(s => s.id === payload.id);
      if (idx >= 0) all[idx] = payload;
      else all.push(payload);
      this._lsSet('students', all);
      return payload;
    }
  }

  async getAllStudents() {
    await this.init();
    if (this.db) {
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(['students'], 'readonly');
        const store = tx.objectStore('students');
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = (e) => reject(e.target.error);
      });
    } else {
      return this._lsGet('students', []);
    }
  }

  async getStudent(id) {
    await this.init();
    if (this.db) {
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(['students'], 'readonly');
        const store = tx.objectStore('students');
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = (e) => reject(e.target.error);
      });
    } else {
      const all = this._lsGet('students', []);
      return all.find(s => s.id === id) || null;
    }
  }

  async deleteStudent(id) {
    await this.init();
    if (this.db) {
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(['students', 'attendance'], 'readwrite');
        const studentStore = tx.objectStore('students');
        studentStore.delete(id);

        // Also clean up student's attendance records
        const attStore = tx.objectStore('attendance');
        const idx = attStore.index('studentId');
        const req = idx.getAllKeys(id);
        req.onsuccess = () => {
          (req.result || []).forEach(k => attStore.delete(k));
        };

        tx.oncomplete = () => resolve(true);
        tx.onerror = (e) => reject(e.target.error);
      });
    } else {
      let all = this._lsGet('students', []);
      all = all.filter(s => s.id !== id);
      this._lsSet('students', all);

      let att = this._lsGet('attendance', []);
      att = att.filter(a => a.studentId !== id);
      this._lsSet('attendance', att);
      return true;
    }
  }

  // --- ATTENDANCE METHODS ---

  /**
   * Mark attendance for a student on a specific date.
   */
  async markAttendance({ studentId, studentName, date, time, status = 'present', method = 'camera_scan', confidence = null, notes = '' }) {
    await this.init();
    const todayStr = date || this.formatDate(new Date());
    const nowTimeStr = time || this.formatTime(new Date());
    const recordId = `${todayStr}_${studentId}`;

    const record = {
      recordId,
      studentId,
      studentName,
      date: todayStr,
      time: nowTimeStr,
      timestamp: Date.now(),
      status, // 'present' | 'absent' | 'late'
      method, // 'camera_scan' | 'manual' | 'bulk'
      confidence,
      notes
    };

    if (this.db) {
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(['attendance'], 'readwrite');
        const store = tx.objectStore('attendance');
        const req = store.put(record);
        req.onsuccess = () => resolve(record);
        req.onerror = (e) => reject(e.target.error);
      });
    } else {
      const all = this._lsGet('attendance', []);
      const idx = all.findIndex(a => a.recordId === recordId);
      if (idx >= 0) all[idx] = record;
      else all.push(record);
      this._lsSet('attendance', all);
      return record;
    }
  }

  async getAttendanceForDate(dateStr) {
    await this.init();
    if (this.db) {
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(['attendance'], 'readonly');
        const store = tx.objectStore('attendance');
        const index = store.index('date');
        const req = index.getAll(dateStr);
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = (e) => reject(e.target.error);
      });
    } else {
      const all = this._lsGet('attendance', []);
      return all.filter(a => a.date === dateStr);
    }
  }

  async getAllAttendance() {
    await this.init();
    if (this.db) {
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(['attendance'], 'readonly');
        const store = tx.objectStore('attendance');
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = (e) => reject(e.target.error);
      });
    } else {
      return this._lsGet('attendance', []);
    }
  }

  async toggleStudentAttendance(studentId, dateStr) {
    const records = await this.getAttendanceForDate(dateStr);
    const existing = records.find(r => r.studentId === studentId);
    const student = await this.getStudent(studentId);
    const studentName = student ? student.name : 'Unknown';

    if (existing && existing.status === 'present') {
      return await this.markAttendance({
        studentId,
        studentName,
        date: dateStr,
        status: 'absent',
        method: 'manual',
        notes: 'Manually toggled to absent'
      });
    } else {
      return await this.markAttendance({
        studentId,
        studentName,
        date: dateStr,
        status: 'present',
        method: 'manual',
        notes: 'Manually marked present'
      });
    }
  }

  // --- SETTINGS METHODS ---

  async getSetting(key, defaultVal = null) {
    await this.init();
    if (this.db) {
      return new Promise((resolve) => {
        try {
          const tx = this.db.transaction(['settings'], 'readonly');
          const store = tx.objectStore('settings');
          const req = store.get(key);
          req.onsuccess = () => resolve(req.result ? req.result.value : defaultVal);
          req.onerror = () => resolve(defaultVal);
        } catch (e) {
          resolve(this._lsGet('setting_' + key, defaultVal));
        }
      });
    } else {
      return this._lsGet('setting_' + key, defaultVal);
    }
  }

  async setSetting(key, value) {
    await this.init();
    if (this.db) {
      return new Promise((resolve, reject) => {
        try {
          const tx = this.db.transaction(['settings'], 'readwrite');
          const store = tx.objectStore('settings');
          const req = store.put({ key, value });
          req.onsuccess = () => resolve(true);
          req.onerror = (e) => reject(e.target.error);
        } catch (e) {
          this._lsSet('setting_' + key, value);
          resolve(true);
        }
      });
    } else {
      this._lsSet('setting_' + key, value);
      return true;
    }
  }

  // --- SEED SAMPLE DATA FOR NTCC PRESENTATION ---

  async seedDemoData() {
    await this.init();

    // Default start date: 3 weeks ago
    const today = new Date();
    const startDate = new Date();
    startDate.setDate(today.getDate() - 21);

    const defaultStartDateStr = this.formatDate(startDate);
    await this.setSetting('starting_date', defaultStartDateStr);

    // Realistic Demo Students with avatar generator / SVG face portraits
    const sampleStudents = [
      {
        id: 'NTCC-01',
        name: 'Aarav Sharma',
        rollNo: 'NTCC-01',
        department: 'B.Tech CSE - 7th Sem',
        email: 'aarav.sharma@college.edu',
        photo: this._generateAvatarSvg('Aarav Sharma', '#3b82f6'),
        descriptor: this._generateSimulatedDescriptor('Aarav Sharma'),
        createdAt: startDate.toISOString()
      },
      {
        id: 'NTCC-02',
        name: 'Priya Patel',
        rollNo: 'NTCC-02',
        department: 'B.Tech CSE - 7th Sem',
        email: 'priya.patel@college.edu',
        photo: this._generateAvatarSvg('Priya Patel', '#ec4899'),
        descriptor: this._generateSimulatedDescriptor('Priya Patel'),
        createdAt: startDate.toISOString()
      },
      {
        id: 'NTCC-03',
        name: 'Rohan Verma',
        rollNo: 'NTCC-03',
        department: 'B.Tech IT - 7th Sem',
        email: 'rohan.verma@college.edu',
        photo: this._generateAvatarSvg('Rohan Verma', '#10b981'),
        descriptor: this._generateSimulatedDescriptor('Rohan Verma'),
        createdAt: startDate.toISOString()
      },
      {
        id: 'NTCC-04',
        name: 'Ananya Gupta',
        rollNo: 'NTCC-04',
        department: 'B.Tech CSE - 7th Sem',
        email: 'ananya.gupta@college.edu',
        photo: this._generateAvatarSvg('Ananya Gupta', '#8b5cf6'),
        descriptor: this._generateSimulatedDescriptor('Ananya Gupta'),
        createdAt: startDate.toISOString()
      },
      {
        id: 'NTCC-05',
        name: 'Karan Mehra',
        rollNo: 'NTCC-05',
        department: 'B.Tech ECE - 7th Sem',
        email: 'karan.mehra@college.edu',
        photo: this._generateAvatarSvg('Karan Mehra', '#f59e0b'),
        descriptor: this._generateSimulatedDescriptor('Karan Mehra'),
        createdAt: startDate.toISOString()
      },
      {
        id: 'NTCC-06',
        name: 'Sneha Rao',
        rollNo: 'NTCC-06',
        department: 'B.Tech IT - 7th Sem',
        email: 'sneha.rao@college.edu',
        photo: this._generateAvatarSvg('Sneha Rao', '#06b6d4'),
        descriptor: this._generateSimulatedDescriptor('Sneha Rao'),
        createdAt: startDate.toISOString()
      }
    ];

    for (const student of sampleStudents) {
      await this.saveStudent(student);
    }

    // Generate daily attendance for working days (Mon-Fri) from startDate up to yesterday
    const currentDate = new Date(startDate);
    const dayTimes = ['09:05:12', '09:12:44', '09:15:30', '09:21:05', '09:28:18', '09:32:50'];

    while (currentDate <= today) {
      const dayOfWeek = currentDate.getDay();
      // Skip Sundays (0)
      if (dayOfWeek !== 0) {
        const dateStr = this.formatDate(currentDate);

        // Realistic attendance probability per student
        const attendanceProbabilities = {
          'NTCC-01': 0.95, // Aarav: 95%
          'NTCC-02': 0.90, // Priya: 90%
          'NTCC-03': 0.70, // Rohan: 70% (Low attendance warning demo)
          'NTCC-04': 0.85, // Ananya: 85%
          'NTCC-05': 0.60, // Karan: 60% (Low attendance warning demo)
          'NTCC-06': 0.92  // Sneha: 92%
        };

        let timeIdx = 0;
        for (const student of sampleStudents) {
          const prob = attendanceProbabilities[student.id] || 0.8;
          const isPresent = Math.random() < prob;
          const time = dayTimes[timeIdx % dayTimes.length];
          timeIdx++;

          await this.markAttendance({
            studentId: student.id,
            studentName: student.name,
            date: dateStr,
            time: isPresent ? time : null,
            status: isPresent ? 'present' : 'absent',
            method: isPresent ? (Math.random() > 0.15 ? 'camera_scan' : 'manual') : 'absent',
            confidence: isPresent ? Math.floor(88 + Math.random() * 11) : null
          });
        }
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return { studentsCount: sampleStudents.length, startDate: defaultStartDateStr };
  }

  async clearAllData() {
    await this.init();
    if (this.db) {
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(['students', 'attendance', 'settings'], 'readwrite');
        tx.objectStore('students').clear();
        tx.objectStore('attendance').clear();
        tx.objectStore('settings').clear();
        tx.oncomplete = () => {
          localStorage.clear();
          resolve(true);
        };
        tx.onerror = (e) => reject(e.target.error);
      });
    } else {
      localStorage.clear();
      return true;
    }
  }

  // --- UTILITIES ---

  formatDate(date) {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  formatTime(date) {
    const d = new Date(date);
    return d.toTimeString().split(' ')[0];
  }

  _lsGet(key, defaultVal) {
    try {
      const item = localStorage.getItem('oni_' + key);
      return item ? JSON.parse(item) : defaultVal;
    } catch (e) {
      return defaultVal;
    }
  }

  _lsSet(key, val) {
    try {
      localStorage.setItem('oni_' + key, JSON.stringify(val));
    } catch (e) {
      console.warn('LocalStorage write failed', e);
    }
  }

  _generateAvatarSvg(name, bg = '#4f46e5') {
    const initials = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">
        <defs>
          <linearGradient id="grad-${initials}" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="${bg}" />
            <stop offset="100%" stop-color="#1e1b4b" />
          </linearGradient>
        </defs>
        <rect width="120" height="120" rx="30" fill="url(#grad-${initials})" />
        <circle cx="60" cy="50" r="24" fill="rgba(255,255,255,0.2)" />
        <path d="M 25 105 Q 60 70 95 105" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="8" stroke-linecap="round" />
        <text x="60" y="58" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="22" font-weight="700" fill="#ffffff" text-anchor="middle" dominant-baseline="central">${initials}</text>
      </svg>
    `.trim();
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  _generateSimulatedDescriptor(seedStr) {
    // Generate deterministic 128-float vector for mock demo students
    let hash = 0;
    for (let i = 0; i < seedStr.length; i++) {
      hash = (hash << 5) - hash + seedStr.charCodeAt(i);
      hash |= 0;
    }
    const arr = [];
    for (let i = 0; i < 128; i++) {
      const v = Math.sin(hash + i) * 0.5;
      arr.push(Number(v.toFixed(6)));
    }
    return arr;
  }
}

window.attendanceStorage = new AttendanceStorage();
