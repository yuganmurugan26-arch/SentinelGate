/**
 * SentinelGate — Attendance UI
 * -------------------------------------------------------------
 * This file does NOT modify script.js. It runs after script.js
 * loads, and layers the Attendance feature on top by:
 *   1. Wrapping navItemsFor() to insert an "Attendance" nav item.
 *   2. Wrapping render() to handle the new 'attendance' view.
 *   3. Adding an icon + page title for it.
 * Everything else in your app (login, OTP, dashboard, resources,
 * users, logs, etc.) is completely untouched.
 *
 * To use: add this line in index.html, right AFTER script.js:
 *   <script src="attendance-ui.js"></script>
 */

/* ============ Hook into the existing nav/render system ============ */

ICONS.attendance = '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/><path d="M8 14l2 2 4-4"/>';

PAGE_META.attendance = { title: 'Attendance', crumb: 'sentinelgate / academic / attendance' };

const _originalNavItemsFor = navItemsFor;
navItemsFor = function (role) {
  const items = _originalNavItemsFor(role);
  // Insert right after "Dashboard" (index 0) for every role.
  items.splice(1, 0, { id: 'attendance', label: 'Attendance', icon: 'attendance' });
  return items;
};

const _originalRender = render;
render = function () {
  if (currentView === 'attendance') {
    const c = document.getElementById('content');
    c.innerHTML = attendanceLoadingHtml();
    loadAttendanceView();
    buildNav();
    return;
  }
  _originalRender();
};

/* ============ Shared helpers ============ */

// The real session token, set by fetchAuthToken() right after login succeeds.
// Every academic.js route now checks this server-side — nothing in these
// requests is trusted just because the browser claims it.
window.authToken = null;

// Called from script.js's handleLoginSubmit() right after the username +
// password check passes, using the same credentials the user just typed.
// This gets a real, signed token from the backend — separate from (and in
// addition to) this app's existing client-side login/MFA flow.
async function fetchAuthToken(username, password) {
  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (data.success) {
      window.authToken = data.token;
    } else {
      window.authToken = null;
      console.warn('Could not establish a secure session:', data.error);
    }
  } catch (err) {
    window.authToken = null;
    console.warn('Could not reach backend to establish a secure session:', err.message);
  }
}

function attendanceLoadingHtml() {
  return `<div class="page-head"><h2>Attendance</h2><p>Loading…</p></div>`;
}

function attendanceErrorHtml(msg) {
  return `<div class="page-head"><h2>Attendance</h2><p style="color:var(--danger)">${esc(msg)}</p></div>`;
}

function authHeaders(extra = {}) {
  const headers = { ...extra };
  if (window.authToken) headers['Authorization'] = `Bearer ${window.authToken}`;
  return headers;
}

async function apiGet(path) {
  const res = await fetch(`${BACKEND_URL}${path}`, { headers: authHeaders() });
  const data = await res.json();
  if (!res.ok || data.success === false) throw new Error(data.error || 'Request failed');
  return data;
}

async function apiPost(path, body) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || data.success === false) throw new Error(data.error || 'Request failed');
  return data;
}

/* ============ Entry point — routes by role ============ */

async function loadAttendanceView() {
  const c = document.getElementById('content');
  try {
    if (session.user.role === 'Student') {
      const html = await renderStudentAttendance();
      c.innerHTML = html;
    } else if (session.user.role === 'Faculty') {
      const html = await renderFacultyAttendance();
      c.innerHTML = html;
      wireFacultyAttendanceEvents();
    } else {
      const html = await renderAdminAttendance();
      c.innerHTML = html;
      wireAdminAttendanceEvents();
    }
  } catch (err) {
    c.innerHTML = attendanceErrorHtml('Could not load attendance data: ' + err.message);
  }
}

/* ============ STUDENT VIEW ============ */

async function renderStudentAttendance() {
  const { enrollments } = await apiGet(`/api/enrollments/student/${session.user.id}`);

  if (!enrollments.length) {
    return `<div class="page-head"><h2>Attendance</h2><p>You are not enrolled in any courses yet. Contact your department admin.</p></div>`;
  }

  const rows = await Promise.all(enrollments.map(async (e) => {
    const course = e.course;
    const att = await apiGet(`/api/attendance/student/${session.user.id}/course/${course.id}`);
    const pct = att.percentage === null ? '—' : att.percentage + '%';
    const color = att.percentage === null ? 'var(--text-faint)'
      : att.percentage >= 75 ? 'var(--success)'
      : att.percentage >= 50 ? 'var(--warning)'
      : 'var(--danger)';
    return `
      <div class="card">
        <h3>${esc(course.name)}</h3>
        <p class="card-sub">${esc(course.code)}${course.semester ? ' · ' + esc(course.semester) : ''}</p>
        <div style="font-family:var(--font-display);font-size:28px;font-weight:700;color:${color}">${pct}</div>
        <p class="card-sub" style="margin-top:6px">${att.present} present · ${att.late} late · ${att.absent} absent (${att.total} sessions)</p>
      </div>`;
  }));

  return `
    <div class="page-head"><h2>My Attendance</h2><p>Live attendance percentage per enrolled course.</p></div>
    <div class="grid grid-3">${rows.join('')}</div>
  `;
}

/* ============ FACULTY VIEW ============ */

async function renderFacultyAttendance() {
  const { courses } = await apiGet(`/api/courses/faculty/${session.user.id}`);

  if (!courses.length) {
    return `<div class="page-head"><h2>Attendance</h2><p>No courses are assigned to you yet. Contact your department admin.</p></div>`;
  }

  const courseOptions = courses.map(c => `<option value="${c.id}">${esc(c.name)} (${esc(c.code)})</option>`).join('');
  const today = new Date().toISOString().slice(0, 10);

  return `
    <div class="page-head"><h2>Mark Attendance</h2><p>Select a course and date, then mark each student.</p></div>
    <div class="card" style="margin-bottom:16px;">
      <div class="grid grid-3" style="align-items:end;">
        <div class="field">
          <label>Course</label>
          <select id="att-course-select">${courseOptions}</select>
        </div>
        <div class="field">
          <label>Date</label>
          <input type="date" id="att-date-input" value="${today}">
        </div>
        <button class="btn" id="att-load-btn">Load students</button>
      </div>
    </div>
    <div id="att-students-container"></div>
  `;
}

function wireFacultyAttendanceEvents() {
  const btn = document.getElementById('att-load-btn');
  if (btn) btn.onclick = loadStudentsForAttendance; // button won't exist if this faculty has no courses assigned
}

async function loadStudentsForAttendance() {
  const courseId = document.getElementById('att-course-select').value;
  const date = document.getElementById('att-date-input').value;
  const container = document.getElementById('att-students-container');
  container.innerHTML = '<p class="card-sub">Loading students…</p>';

  try {
    const { enrollments } = await apiGet(`/api/enrollments/course/${courseId}`);
    const { records } = await apiGet(`/api/attendance/course/${courseId}/date/${date}`);
    const statusByStudent = {};
    records.forEach(r => { statusByStudent[r.student_id] = r.status; });

    if (!enrollments.length) {
      container.innerHTML = '<p class="card-sub">No students enrolled in this course yet.</p>';
      return;
    }

    const rows = enrollments.map(e => {
      const s = e.student;
      const current = statusByStudent[s.id] || '';
      return `
        <div class="card" style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;">
          <div>
            <b>${esc(s.name)}</b>
            <div class="card-sub">${esc(s.username)}</div>
          </div>
          <div style="display:flex;gap:6px;">
            <button class="btn small ${current === 'present' ? '' : 'secondary'}" onclick="markAttendance('${s.id}','${courseId}','${date}','present',this)">Present</button>
            <button class="btn small ${current === 'late' ? '' : 'secondary'}" onclick="markAttendance('${s.id}','${courseId}','${date}','late',this)">Late</button>
            <button class="btn small ${current === 'absent' ? 'danger-btn' : 'secondary'}" onclick="markAttendance('${s.id}','${courseId}','${date}','absent',this)">Absent</button>
          </div>
        </div>`;
    });
    container.innerHTML = rows.join('');
  } catch (err) {
    container.innerHTML = `<p style="color:var(--danger)">Could not load students: ${esc(err.message)}</p>`;
  }
}

async function markAttendance(studentId, courseId, date, status, btnEl) {
  try {
    await apiPost('/api/attendance', {
      studentId, courseId, date, status,
      markedBy: session.user.id,
      requesterRole: session.user.role,
    });
    // Reset sibling buttons in this row, highlight the one just clicked.
    const row = btnEl.closest('.card');
    row.querySelectorAll('button').forEach(b => { b.classList.add('secondary'); b.classList.remove('danger-btn'); });
    btnEl.classList.remove('secondary');
    if (status === 'absent') btnEl.classList.add('danger-btn');
    toast('Attendance saved', `Marked ${status} for the selected date.`, 'success');
  } catch (err) {
    toast('Failed to save', err.message, 'error');
  }
}

/* ============ ADMIN VIEW ============ */

// Builds a human-readable dropdown option, but the value is still the real numeric ID.
function userOption(u) {
  return `<option value="${u.id}">${esc(u.name)} (@${esc(u.username)}) — ID ${u.id}</option>`;
}

async function renderAdminAttendance() {
  const { courses } = await apiGet('/api/courses');

  const courseRows = courses.map(c => {
    const faculty = DB.users.find(u => String(u.id) === String(c.faculty_id));
    return `
    <div class="card" style="margin-bottom:10px;">
      <h3>${esc(c.name)} <span class="card-sub">(${esc(c.code)})</span></h3>
      <p class="card-sub">${c.semester ? esc(c.semester) : 'No semester set'} · Faculty: ${faculty ? esc(faculty.name) : '— unassigned —'}</p>
    </div>`;
  }).join('') || '<p class="card-sub">No courses created yet.</p>';

  const faculty = DB.users.filter(u => u.role === 'Faculty');
  const students = DB.users.filter(u => u.role === 'Student');

  const facultyOptions = faculty.length
    ? faculty.map(userOption).join('')
    : '<option value="">No faculty accounts found</option>';
  const studentOptions = students.length
    ? students.map(userOption).join('')
    : '<option value="">No student accounts found</option>';
  const courseOptionsForEnroll = courses.length
    ? courses.map(c => `<option value="${c.id}">${esc(c.name)} (${esc(c.code)})</option>`).join('')
    : '<option value="">No courses yet — create one first</option>';

  return `
    <div class="page-head"><h2>Attendance — Administration</h2><p>Create courses and enroll students. Faculty then mark attendance from their own view.</p></div>

    <div class="grid grid-2" style="align-items:start;">
      <div>
        <h3 style="font-family:var(--font-display);margin-bottom:10px;">Existing courses</h3>
        ${courseRows}
      </div>

      <div class="card">
        <h3>Create a course</h3>
        <div class="field"><label>Course name</label><input id="new-course-name" placeholder="e.g. Data Structures"></div>
        <div class="field"><label>Course code</label><input id="new-course-code" placeholder="e.g. CS301"></div>
        <div class="field"><label>Faculty</label><select id="new-course-faculty">${facultyOptions}</select></div>
        <div class="field"><label>Semester</label><input id="new-course-semester" placeholder="e.g. 6th"></div>
        <button class="btn" id="create-course-btn" style="margin-top:8px;">Create course</button>

        <hr style="border-color:var(--border);margin:18px 0;">

        <h3>Enroll a student</h3>
        <div class="field"><label>Course</label><select id="enroll-course-id">${courseOptionsForEnroll}</select></div>
        <div class="field"><label>Student</label><select id="enroll-student-id">${studentOptions}</select></div>
        <button class="btn" id="enroll-student-btn" style="margin-top:8px;">Enroll student</button>
      </div>
    </div>
  `;
}

function wireAdminAttendanceEvents() {
  document.getElementById('create-course-btn').onclick = async () => {
    const name = document.getElementById('new-course-name').value.trim();
    const code = document.getElementById('new-course-code').value.trim();
    const facultyId = document.getElementById('new-course-faculty').value;
    const semester = document.getElementById('new-course-semester').value.trim();
    if (!name || !code) { toast('Missing fields', 'Course name and code are required.', 'error'); return; }
    try {
      await apiPost('/api/courses', { name, code, facultyId, semester, requesterRole: session.user.role });
      toast('Course created', `${name} was added.`, 'success');
      loadAttendanceView();
    } catch (err) {
      toast('Failed to create course', err.message, 'error');
    }
  };

  document.getElementById('enroll-student-btn').onclick = async () => {
    const courseId = document.getElementById('enroll-course-id').value;
    const studentId = document.getElementById('enroll-student-id').value;
    if (!courseId || !studentId) { toast('Missing fields', 'Pick both a course and a student.', 'error'); return; }
    try {
      await apiPost('/api/enrollments', { courseId, studentId, requesterRole: session.user.role });
      const student = DB.users.find(u => String(u.id) === String(studentId));
      toast('Student enrolled', `${student ? student.name : 'Student'} was enrolled.`, 'success');
    } catch (err) {
      toast('Failed to enroll', err.message, 'error');
    }
  };
}