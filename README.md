# onliattend - Smart Biometric Face Recognition Attendance Web Application

**onliattend** is an intelligent, camera-powered face recognition attendance management web application developed as an **NTCC (Non-Teaching Credit Course) Project**. It runs directly inside Google Chrome as an installable Chrome Web App (PWA) and performs real-time client-side face detection, student enrollment with Face ID, automated daily attendance marking, and dynamic presence vs. absence analytics calculated from any custom calendar starting date.

---

## 🌟 Key Features

### 1. 📷 Camera Face Recognition Attendance Marking
* **Real-time Live Scanning**: Utilizes the user's webcam with biometric HUD overlay, laser sweep animation, and corner reticles.
* **Instant Facial Identification**: Extracts 128-dimensional facial embeddings and matches them against enrolled students using Euclidean distance.
* **Audio & Visual Feedback**: Synthesizes biometric chime sounds on recognition and displays a slide-in student banner with match percentage and timestamp.
* **Double-Mark Prevention**: Automatically detects if a student has already been marked present for the current day to avoid duplicate records.

### 2. 👥 Student Face ID Enrollment
* **Save Name with Face ID**: Enroll new students with Full Name, Student ID / Roll Number, Department, and Biometric Face ID.
* **Dual Capture Modes**:
  * **Live Webcam Capture**: Takes a live snapshot and extracts facial landmarks and descriptor with biometric quality scoring.
  * **Photo Upload**: Allows uploading a headshot photo directly from disk.
* **Student Directory**: Search, view enrolled biometric profiles, and delete/manage students.

### 3. 📊 Interactive Analytics & Calendar Starting Day Option
* **Calendar Starting Date Selector**: Pick any calendar date as the starting day of attendance (e.g. semester beginning or custom period).
* **Presence vs Absence Trend Chart**: Stacked visual chart showing the volume of present students vs absent students for every single working day since the selected start date.
* **Student Performance Ranking**: Horizontal bar chart comparing individual student attendance rates with a university standard 75% minimum eligibility benchmark.
* **Donut Distribution**: Overall presence vs absence ratio breakdown across the entire session.
* **KPI Metrics**: Real-time summary cards for Attendance Rate %, Total Working Days, Active Enrolled Students, and Students with Shortage Warnings (<75%).
* **CSV Export**: One-click download of attendance summary reports formatted for submission to faculty and evaluators.

### 4. 📋 Daily Attendance Register
* Date-by-date register table showing check-in timestamp and verification method (Camera Face Scan vs Manual).
* One-click toggle between **Present** and **Absent** for manual exceptions.
* Quick bulk actions: *Mark All Present* and *Clear Day*.

### 5. ⚡ NTCC Presentation Demo Data Generator
* Includes a 1-click **Demo Data Generator** in Settings that seeds 6 sample engineering students and 21 days of realistic daily attendance history.
* Allows instant demonstration of charts, shortage alerts, and trends to professors without manual data entry.

---

## 🛠️ Technology Stack

* **Front-end**: HTML5 Semantic markup, Modern Vanilla CSS (Glassmorphism, Dark Mode, Micro-animations, CSS Grid/Flexbox).
* **Biometric AI Engine**: `face-api.js` (TensorFlow.js backend) running TinyFaceDetector, 68-point Face Landmarks Net, and Deep Face Recognition Net directly in the browser.
* **Data Visualizations**: `Chart.js` for responsive, interactive bar and donut charts.
* **Storage**: Browser-native `IndexedDB` with asynchronous transaction management and `LocalStorage` fallback.
* **Sound Engine**: Web Audio API oscillator synthesis (no external MP3 dependencies).
* **Application Mode**: Chrome Web App / Progressive Web App (PWA) with `manifest.json` and `sw.js` Service Worker.

---

## 🚀 How to Run Locally

You can launch **onliattend** directly by double-clicking:
👉 `start_onliattend.bat`

Or run using Python's built-in HTTP server:

```powershell
# Navigate to the NTCC directory
cd c:\Users\HP_Pc\NTCC

# Start local server on port 8000
python -m http.server 8000
```

Then open your browser (Google Chrome recommended):
👉 **http://localhost:8000**

> **Note on Chrome Permissions**: Browsers treat `http://localhost:*` as a secure origin, allowing webcam access without requiring HTTPS configuration.

### How to Install as a Chrome Web App:
1. Open `http://localhost:8000` in Google Chrome.
2. Click the **"📥 Install App"** button in the top-right header, OR click the install icon in Chrome's address bar.
3. OnliAttend will open in its own standalone, distraction-free desktop window!

---

## 📂 Project Structure

```
c:\Users\HP_Pc\NTCC\
├── index.html                   # Main single-page web app structure
├── manifest.json                # Chrome Web App PWA manifest
├── sw.js                        # Service worker for offline caching & PWA support
├── README.md                    # Project documentation & report
├── css\
│   └── style.css                # Glassmorphism styling, theme, and animations
├── js\
│   ├── app.js                   # Application coordinator, navigation, and modal logic
│   ├── face-service.js          # Face-api.js wrapper, camera management, face matching
│   ├── storage.js               # IndexedDB storage and demo data generator
│   └── charts.js                # Chart.js analytics engine with calendar range calculations
├── models\                      # Pre-downloaded neural network weights (offline ready)
│   ├── tiny_face_detector_model-weights_manifest.json
│   ├── tiny_face_detector_model.bin
│   ├── face_landmark_68_model-weights_manifest.json
│   ├── face_landmark_68_model.bin
│   ├── face_recognition_model-weights_manifest.json
│   └── face_recognition_model.bin
├── vendor\                      # Local vendor libraries
│   ├── chart.umd.min.js         # Chart.js library
│   └── face-api.min.js          # Face-api.js library
└── icons\                       # Chrome web app icons and logos
    ├── logo.jpg
    ├── icon-192.png
    ├── icon-512.png
    └── favicon.png
```

---

## 🔒 Privacy & Biometrics

All face detection and matching is computed **100% locally on the client's device**. No camera streams, photos, or biometric vectors are transmitted over the internet or sent to external cloud servers, ensuring strict privacy compliance.
