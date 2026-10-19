/**
 * OniAttendance - Analytics & Charts Engine
 * Generates interactive presence vs. absence visual reports calculated from
 * the user-selected starting calendar date. Powered by Chart.js.
 */

class AttendanceChartsManager {
  constructor() {
    this.trendChart = null;
    this.studentChart = null;
    this.donutChart = null;
    this.startDate = null;
    this.endDate = null;
  }

  /**
   * Set starting date and refresh all analytics
   */
  async updateDateRange(startDateStr, endDateStr = null) {
    this.startDate = startDateStr;
    this.endDate = endDateStr || attendanceStorage.formatDate(new Date());
    await attendanceStorage.setSetting('starting_date', this.startDate);
    await this.renderDashboard();
  }

  /**
   * Compute attendance statistics between startDate and endDate
   */
  async computeStatistics() {
    const students = await attendanceStorage.getAllStudents();
    const allAttendance = await attendanceStorage.getAllAttendance();

    if (!this.startDate) {
      // Default: 14 days ago if not set
      const d = new Date();
      d.setDate(d.getDate() - 14);
      this.startDate = attendanceStorage.formatDate(d);
    }
    if (!this.endDate) {
      this.endDate = attendanceStorage.formatDate(new Date());
    }

    const start = new Date(this.startDate);
    const end = new Date(this.endDate);

    // Generate array of date strings between start and end (inclusive)
    const dateList = [];
    const curr = new Date(start);
    while (curr <= end) {
      // Skip Sundays (0)
      if (curr.getDay() !== 0) {
        dateList.push(attendanceStorage.formatDate(curr));
      }
      curr.setDate(curr.getDate() + 1);
    }

    // Map of records for quick lookup: date_studentId -> record
    const recordMap = new Map();
    allAttendance.forEach(rec => {
      recordMap.set(`${rec.date}_${rec.studentId}`, rec);
    });

    // Daily breakdown for Trend Chart
    const dailyStats = dateList.map(dateStr => {
      let presentCount = 0;
      let absentCount = 0;

      students.forEach(student => {
        const key = `${dateStr}_${student.id}`;
        const record = recordMap.get(key);
        if (record && record.status === 'present') {
          presentCount++;
        } else {
          // If no record exists or marked absent, counted as absent
          absentCount++;
        }
      });

      return {
        date: dateStr,
        present: presentCount,
        absent: absentCount,
        totalStudents: students.length
      };
    });

    // Student-wise breakdown
    const totalWorkingDays = dateList.length;
    const studentStats = students.map(student => {
      let daysPresent = 0;

      dateList.forEach(dateStr => {
        const key = `${dateStr}_${student.id}`;
        const record = recordMap.get(key);
        if (record && record.status === 'present') {
          daysPresent++;
        }
      });

      const daysAbsent = Math.max(0, totalWorkingDays - daysPresent);
      const percentage = totalWorkingDays > 0 ? Math.round((daysPresent / totalWorkingDays) * 100) : 0;

      return {
        id: student.id,
        name: student.name,
        rollNo: student.rollNo || student.id,
        department: student.department || 'N/A',
        photo: student.photo,
        daysPresent,
        daysAbsent,
        percentage,
        isShortage: percentage < 75 // University 75% attendance benchmark
      };
    });

    // Aggregate Totals
    const totalPossibleSlots = students.length * totalWorkingDays;
    let totalPresentOverall = 0;
    dailyStats.forEach(d => { totalPresentOverall += d.present; });
    const totalAbsentOverall = Math.max(0, totalPossibleSlots - totalPresentOverall);
    const overallRate = totalPossibleSlots > 0 ? Math.round((totalPresentOverall / totalPossibleSlots) * 100) : 0;
    const studentsAtRisk = studentStats.filter(s => s.isShortage).length;

    return {
      startDate: this.startDate,
      endDate: this.endDate,
      totalWorkingDays,
      totalStudents: students.length,
      totalPossibleSlots,
      totalPresentOverall,
      totalAbsentOverall,
      overallRate,
      studentsAtRisk,
      dailyStats,
      studentStats
    };
  }

  /**
   * Render all visual charts and KPI metric cards
   */
  async renderDashboard() {
    const stats = await this.computeStatistics();

    // 1. Update KPI overview cards
    this._renderKpiCards(stats);

    // 2. Render Daily Presence vs Absence Trend Chart
    this._renderTrendChart(stats.dailyStats);

    // 3. Render Student Performance Comparison Bar Chart
    this._renderStudentChart(stats.studentStats);

    // 4. Render Presence vs Absence Proportion Donut Chart
    this._renderDonutChart(stats.totalPresentOverall, stats.totalAbsentOverall);

    // 5. Render Student Breakdown Table
    this._renderStudentTable(stats.studentStats, stats.totalWorkingDays);
  }

  _renderKpiCards(stats) {
    const rateEl = document.getElementById('kpiAttendanceRate');
    const workingDaysEl = document.getElementById('kpiWorkingDays');
    const totalStudentsEl = document.getElementById('kpiTotalStudents');
    const atRiskEl = document.getElementById('kpiAtRisk');
    const dateRangeLabelEl = document.getElementById('kpiDateRangeLabel');

    if (rateEl) {
      rateEl.textContent = `${stats.overallRate}%`;
      rateEl.className = 'kpi-value ' + (stats.overallRate >= 75 ? 'text-emerald' : stats.overallRate >= 60 ? 'text-amber' : 'text-rose');
    }
    if (workingDaysEl) workingDaysEl.textContent = stats.totalWorkingDays;
    if (totalStudentsEl) totalStudentsEl.textContent = stats.totalStudents;
    if (atRiskEl) {
      atRiskEl.textContent = stats.studentsAtRisk;
      atRiskEl.className = 'kpi-value ' + (stats.studentsAtRisk > 0 ? 'text-rose' : 'text-emerald');
    }
    if (dateRangeLabelEl) {
      dateRangeLabelEl.textContent = `Since ${stats.startDate} to ${stats.endDate}`;
    }
  }

  _renderTrendChart(dailyStats) {
    const ctx = document.getElementById('trendChartCanvas');
    if (!ctx) return;

    if (this.trendChart) {
      this.trendChart.destroy();
    }

    const labels = dailyStats.map(d => {
      const parts = d.date.split('-');
      return `${parts[1]}/${parts[2]}`; // MM/DD
    });
    const presentData = dailyStats.map(d => d.present);
    const absentData = dailyStats.map(d => d.absent);

    this.trendChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Present Students',
            data: presentData,
            backgroundColor: 'rgba(16, 185, 129, 0.85)', // Emerald
            borderColor: '#10b981',
            borderRadius: 6,
            borderSkipped: false,
            maxBarThickness: 32
          },
          {
            label: 'Absent Students',
            data: absentData,
            backgroundColor: 'rgba(244, 63, 94, 0.65)', // Rose
            borderColor: '#f43f5e',
            borderRadius: 6,
            borderSkipped: false,
            maxBarThickness: 32
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              color: '#94a3b8',
              font: { family: 'Inter', size: 12, weight: '500' },
              usePointStyle: true,
              pointStyle: 'circle'
            }
          },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            titleColor: '#f8fafc',
            bodyColor: '#cbd5e1',
            borderColor: 'rgba(255,255,255,0.1)',
            borderWidth: 1,
            padding: 12,
            cornerRadius: 8
          }
        },
        scales: {
          x: {
            stacked: true,
            grid: { display: false },
            ticks: { color: '#64748b', font: { size: 11 } }
          },
          y: {
            stacked: true,
            beginAtZero: true,
            grid: { color: 'rgba(255, 255, 255, 0.06)' },
            ticks: {
              color: '#64748b',
              stepSize: 1,
              precision: 0
            }
          }
        }
      }
    });
  }

  _renderStudentChart(studentStats) {
    const ctx = document.getElementById('studentChartCanvas');
    if (!ctx) return;

    if (this.studentChart) {
      this.studentChart.destroy();
    }

    // Sort students by percentage descending
    const sorted = [...studentStats].sort((a, b) => b.percentage - a.percentage);
    const labels = sorted.map(s => s.name);
    const percentages = sorted.map(s => s.percentage);
    const colors = sorted.map(s => s.percentage >= 75 ? 'rgba(16, 185, 129, 0.85)' : 'rgba(244, 63, 94, 0.85)');

    this.studentChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Attendance Rate (%)',
          data: percentages,
          backgroundColor: colors,
          borderRadius: 6,
          maxBarThickness: 28
        }]
      },
      options: {
        indexAxis: 'y', // Horizontal bars for clean student names readability
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => `Attendance: ${context.parsed.x}% (${sorted[context.dataIndex].daysPresent} Days Present)`
            }
          }
        },
        scales: {
          x: {
            min: 0,
            max: 100,
            grid: { color: 'rgba(255, 255, 255, 0.06)' },
            ticks: {
              color: '#64748b',
              callback: (v) => `${v}%`
            }
          },
          y: {
            grid: { display: false },
            ticks: { color: '#94a3b8', font: { size: 12 } }
          }
        }
      }
    });
  }

  _renderDonutChart(presentTotal, absentTotal) {
    const ctx = document.getElementById('donutChartCanvas');
    if (!ctx) return;

    if (this.donutChart) {
      this.donutChart.destroy();
    }

    const total = presentTotal + absentTotal;
    const presentPct = total > 0 ? Math.round((presentTotal / total) * 100) : 0;

    this.donutChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Present Days', 'Absent Days'],
        datasets: [{
          data: [presentTotal, absentTotal],
          backgroundColor: ['#10b981', '#f43f5e'],
          borderColor: '#0f172a',
          borderWidth: 3,
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '72%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: '#94a3b8',
              usePointStyle: true,
              pointStyle: 'circle',
              padding: 16
            }
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                const val = context.parsed;
                const pct = total > 0 ? Math.round((val / total) * 100) : 0;
                return ` ${context.label}: ${val} (${pct}%)`;
              }
            }
          }
        }
      }
    });

    const donutCenterText = document.getElementById('donutCenterRate');
    if (donutCenterText) {
      donutCenterText.textContent = `${presentPct}%`;
    }
  }

  _renderStudentTable(studentStats, totalDays) {
    const tbody = document.getElementById('studentAnalyticsTableBody');
    if (!tbody) return;

    if (!studentStats || studentStats.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-8">No students enrolled yet. Add students or load demo data.</td></tr>`;
      return;
    }

    tbody.innerHTML = studentStats.map(s => {
      const statusBadge = s.isShortage
        ? `<span class="badge badge-danger">⚠️ Shortage (&lt;75%)</span>`
        : `<span class="badge badge-success">✓ Eligible</span>`;

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
          <td class="text-muted text-sm">${s.department}</td>
          <td class="text-emerald font-semibold">${s.daysPresent} <span class="text-xs text-muted">/ ${totalDays}</span></td>
          <td class="text-rose font-semibold">${s.daysAbsent}</td>
          <td>
            <div class="progress-bar-container">
              <div class="progress-bar ${s.isShortage ? 'bg-rose' : 'bg-emerald'}" style="width: ${s.percentage}%"></div>
              <span class="progress-bar-text">${s.percentage}%</span>
            </div>
          </td>
          <td>${statusBadge}</td>
        </tr>
      `;
    }).join('');
  }
}

window.chartsManager = new AttendanceChartsManager();
