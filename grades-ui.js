/**
 * SentinelGate — Grades UI
 * -------------------------------------------------------------
 * Loads AFTER script.js and attendance-ui.js. Adds a "Grades" nav
 * item and view, the same wrapping technique attendance-ui.js
 * used — never edits either file directly.
 *
 * Reuses apiGet/apiPost/esc/toast/DB/session/BACKEND_URL, all
 * already defined globally by the earlier scripts.
 *
 * To use: in index.html, add this line AFTER attendance-ui.js:
 *   <script src="grades-ui.js"></script>
 */

/* ============ Hook into the existing nav/render system ============ */

ICONS.grades = '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M9 7h6M9 11h6"/>';

PAGE_META.grades = { title: 'Grades', crumb: 'sentinelgate / academic / grades' };

// Different variable names than attendance-ui.js used (_originalNavItemsFor,
// _originalRender) — reusing the same const names here would throw a
// "already declared" error, since classic <script> tags share one global
// scope for top-level const/let.
const _navItemsForBeforeGrades = navItemsFor;
navItemsFor = function (role) {
  const items = _navItemsForBeforeGrades(role);
  const attendanceIdx = items.findIndex(i => i.id === 'attendance');
  const insertAt = attendanceIdx >= 0 ? attendanceIdx + 1 : 1;
  items.splice(insertAt, 0, { id: 'grades', label: 'Grades', icon: 'grades' });
  return items;
};

const _renderBeforeGrades = render;
render = function () {
  if (currentView === 'grades') {
    const c = document.getElementById('content');
    c.innerHTML = gradesLoadingHtml();
    loadGradesView();
    buildNav();
    return;
  }
  _renderBeforeGrades();
};

/* ============ Shared helpers ============ */

function gradesLoadingHtml() {
  return `<div class="page-head"><h2>Grades</h2><p>Loading…</p></div>`;
}

function gradesErrorHtml(msg) {
  return `<div class="page-head"><h2>Grades</h2><p style="color:var(--danger)">${esc(msg)}</p></div>`;
}

function gradeColor(pct) {
  if (pct === null) return 'var(--text-faint)';
  if (pct >= 75) return 'var(--success)';
  if (pct >= 50) return 'var(--warning)';
  return 'var(--danger)';
}

/* ============ Entry point — routes by role ============ */

async function loadGradesView() {
  const c = document.getElementById('content');
  try {
    if (session.user.role === 'Student') {
      c.innerHTML = await renderStudentGrades();
    } else if (session.user.role === 'Faculty') {
      c.innerHTML = await renderFacultyGrades();
      wireFacultyGradesEvents();
    } else {
      c.innerHTML = await renderAdminGrades();
      wireAdminGradesEvents();
    }
  } catch (err) {
    c.innerHTML = gradesErrorHtml('Could not load grades: ' + err.message);
  }
}

/* ============ STUDENT VIEW ============ */

async function renderStudentGrades() {
  const { enrollments } = await apiGet(`/api/enrollments/student/${session.user.id}`);

  if (!enrollments.length) {
    return `<div class="page-head"><h2>Grades</h2><p>You are not enrolled in any courses yet.</p></div>`;
  }

  const cards = await Promise.all(enrollments.map(async (e) => {
    const course = e.course;
    const g = await apiGet(`/api/grades/student/${session.user.id}/course/${course.id}`);
    const pct = g.percentage === null ? '—' : g.percentage + '%';
    const color = gradeColor(g.percentage);

    const rows = g.grades.length
      ? g.grades.map(row => `
          <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border-soft);font-size:13px;">
            <span>${esc(row.exam_type)}</span>
            <span style="color:var(--text-dim)">${row.marks}/${row.max_marks}</span>
          </div>`).join('')
      : '<p class="card-sub">No grades entered yet.</p>';

    return `
      <div class="card">
        <h3>${esc(course.name)}</h3>
        <p class="card-sub">${esc(course.code)}${course.semester ? ' · ' + esc(course.semester) : ''}</p>
        <div style="font-family:var(--font-display);font-size:28px;font-weight:700;color:${color};margin:8px 0;">${pct}</div>
        ${rows}
      </div>`;
  }));

  return `
    <div class="page-head"><h2>My Grades</h2><p>Overall percentage and exam-wise breakdown per course.</p></div>
    <div class="grid grid-3">${cards.join('')}</div>
  `;
}

/* ============ FACULTY VIEW ============ */

async function renderFacultyGrades() {
  const { courses } = await apiGet(`/api/courses/faculty/${session.user.id}`);

  if (!courses.length) {
    return `<div class="page-head"><h2>Grades</h2><p>No courses are assigned to you yet.</p></div>`;
  }

  // data-semester carries each course's real semester (from the courses table)
  // onto its <option>, so selecting a course can auto-fill the exam field below
  // without another network round-trip.
  const courseOptions = courses
    .map(c => `<option value="${c.id}" data-semester="${esc(c.semester || '')}">${esc(c.name)} (${esc(c.code)})</option>`)
    .join('');

  return `
    <div class="page-head"><h2>Enter Grades</h2><p>Select a course — the semester is loaded automatically from the course record so it can't be entered wrong.</p></div>
    <div class="card" style="margin-bottom:16px;">
      <div class="grid grid-3" style="align-items:end;">
        <div class="field">
          <label>Course</label>
          <select id="grades-course-select">${courseOptions}</select>
        </div>
        <div class="field">
          <label>Semester</label>
          <input id="grades-examtype-input" readonly>
        </div>
        <button class="btn" id="grades-load-btn">Load students</button>
      </div>
      <p class="card-sub" style="margin-top:8px;">Semester is auto-loaded from the course record and cannot be edited here.</p>
    </div>
    <div id="grades-students-container"></div>
  `;
}

function wireFacultyGradesEvents() {
  const courseSelect = document.getElementById('grades-course-select');
  const examInput = document.getElementById('grades-examtype-input');

  function syncSemesterFromCourse() {
    if (!courseSelect || !examInput) return;
    const opt = courseSelect.options[courseSelect.selectedIndex];
    const sem = opt ? (opt.dataset.semester || '') : '';
    examInput.value = sem;
    examInput.placeholder = sem ? '' : 'No semester set on this course — contact Admin';
  }

  if (courseSelect) {
    courseSelect.onchange = syncSemesterFromCourse;
    syncSemesterFromCourse(); // fill immediately for the pre-selected first course
  }

  const btn = document.getElementById('grades-load-btn');
  if (btn) btn.onclick = loadStudentsForGrades; // button won't exist if this faculty has no courses assigned
}

async function loadStudentsForGrades() {
  const courseId = document.getElementById('grades-course-select').value;
  const examType = document.getElementById('grades-examtype-input').value.trim();
  const container = document.getElementById('grades-students-container');

  if (!examType) {
    container.innerHTML = '<p style="color:var(--danger)">This course has no semester set in its course record — ask an Admin to set one before entering grades.</p>';
    return;
  }
  container.innerHTML = '<p class="card-sub">Loading students…</p>';

  try {
    const { enrollments } = await apiGet(`/api/enrollments/course/${courseId}`);
    const { grades } = await apiGet(`/api/grades/course/${courseId}?examType=${encodeURIComponent(examType)}`);
    const existingByStudent = {};
    grades.forEach(g => { existingByStudent[g.student_id] = g; });

    if (!enrollments.length) {
      container.innerHTML = '<p class="card-sub">No students enrolled in this course yet.</p>';
      return;
    }

    const rows = enrollments.map(e => {
      const s = e.student;
      const existing = existingByStudent[s.id];
      return `
        <div class="card" style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;" data-student-id="${s.id}">
          <div>
            <b>${esc(s.name)}</b>
            <div class="card-sub">${esc(s.username)}</div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            <input type="number" min="0" class="marks-input" style="width:70px;" value="${existing ? existing.marks : ''}" placeholder="marks">
            <span class="card-sub">/</span>
            <input type="number" min="1" class="maxmarks-input" style="width:70px;" value="${existing ? existing.max_marks : ''}" placeholder="max">
            <button class="btn small" onclick="saveGrade('${s.id}','${courseId}',this)">Save</button>
          </div>
        </div>`;
    });
    container.innerHTML = `<input type="hidden" id="grades-active-examtype" value="${esc(examType)}">` + rows.join('');
  } catch (err) {
    container.innerHTML = `<p style="color:var(--danger)">Could not load students: ${esc(err.message)}</p>`;
  }
}

async function saveGrade(studentId, courseId, btnEl) {
  const row = btnEl.closest('.card');
  const marks = row.querySelector('.marks-input').value;
  const maxMarks = row.querySelector('.maxmarks-input').value;
  const examType = document.getElementById('grades-active-examtype').value;

  if (marks === '' || maxMarks === '') {
    toast('Missing values', 'Enter both marks and max marks.', 'error');
    return;
  }

  try {
    await apiPost('/api/grades', {
      studentId, courseId, examType, marks, maxMarks,
      enteredBy: session.user.id,
      requesterRole: session.user.role,
    });
    toast('Grade saved', `${examType}: ${marks}/${maxMarks} saved.`, 'success');
  } catch (err) {
    toast('Failed to save', err.message, 'error');
  }
}

/* ============ ADMIN VIEW ============ */

async function renderAdminGrades() {
  const { courses } = await apiGet('/api/courses');
  const courseOptions = courses.length
    ? courses.map(c => `<option value="${c.id}">${esc(c.name)} (${esc(c.code)})</option>`).join('')
    : '<option value="">No courses yet</option>';

  return `
    <div class="page-head"><h2>Grades — Overview</h2><p>Pick a course to see every grade entered for it, across all exams.</p></div>
    <div class="card" style="margin-bottom:16px;">
      <div class="grid grid-2" style="align-items:end;">
        <div class="field"><label>Course</label><select id="admin-grades-course-select">${courseOptions}</select></div>
        <button class="btn" id="admin-grades-load-btn">View grades</button>
      </div>
    </div>
    <div id="admin-grades-container"></div>
  `;
}

function wireAdminGradesEvents() {
  document.getElementById('admin-grades-load-btn').onclick = async () => {
    const courseId = document.getElementById('admin-grades-course-select').value;
    const container = document.getElementById('admin-grades-container');
    if (!courseId) { container.innerHTML = '<p class="card-sub">No course selected.</p>'; return; }
    container.innerHTML = '<p class="card-sub">Loading…</p>';
    try {
      const { grades } = await apiGet(`/api/grades/course/${courseId}`);
      if (!grades.length) { container.innerHTML = '<p class="card-sub">No grades entered for this course yet.</p>'; return; }
      const rows = grades.map(g => `
        <div class="card" style="display:flex;justify-content:space-between;margin-bottom:8px;">
          <span><b>${esc(g.student.name)}</b> <span class="card-sub">(${esc(g.student.username)})</span></span>
          <span>${esc(g.exam_type)}: <b>${g.marks}/${g.max_marks}</b></span>
        </div>`).join('');
      container.innerHTML = rows;
    } catch (err) {
      container.innerHTML = `<p style="color:var(--danger)">${esc(err.message)}</p>`;
    }
  };
}