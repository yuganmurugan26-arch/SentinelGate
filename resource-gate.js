/**
 * SentinelGate — Resource Gate for Attendance & Grades
 * -------------------------------------------------------------
 * Loads LAST, after script.js, attendance-ui.js, and grades-ui.js.
 * Does not modify any of them — it wraps render() one more time
 * (same technique the other two files already used) so Attendance
 * and Grades now go through the same "Request Access → Run
 * verification → Granted" pipeline as your original six resources,
 * instead of opening immediately just because the user is logged in.
 *
 * Reuses existing, already-global functions from script.js:
 * evaluateAccess(), runPipelineAnim(), addLog(), DB, session, esc(),
 * nowStr(), toast(), buildNav(). None of them are modified.
 *
 * REQUIRED ONE-TIME SETUP (no code change — just data, via the UI
 * you already have): as Admin, go to Resources & Access Policies
 * and add a new resource named exactly:
 *     Attendance Records
 * with whatever sensitivity/role settings you want Faculty/Admin
 * to need. Grades reuses your existing "Grade Management System"
 * resource, and Students' view of both reuses "My Academic Profile"
 * — both already exist, nothing to add for those.
 *
 * To use: in index.html, add this line AFTER grades-ui.js:
 *   <script src="resource-gate.js"></script>
 */

function requiredResourceFor(view) {
  const role = session.user.role;
  if (view === 'attendance') return role === 'Student' ? 'My Academic Profile' : 'Attendance Records';
  if (view === 'grades') return role === 'Student' ? 'My Academic Profile' : 'Grade Management System';
  return null;
}

// Session-only memory of what's been verified — NOT persisted anywhere.
// This resets every time the page reloads or the user logs in again,
// which is the point: Zero Trust means re-verifying every session,
// not remembering a grant forever after the first check.
const gateGrantedThisSession = new Set();

function hasGrantedAccess(resourceName) {
  return gateGrantedThisSession.has(resourceName);
}

function accessGateHtml(resourceName, featureLabel) {
  const resource = DB.resources.find(r => r.name === resourceName);
  const missing = !resource;
  return `
    <div class="page-head">
      <h2>${esc(featureLabel)}</h2>
      <p>This is a protected resource. Every request runs through the full zero trust pipeline — identity, device posture, and policy are re-checked every time.</p>
    </div>
    <div class="card" style="max-width:560px;">
      <h3>${esc(resourceName)}${resource ? ' · ' + esc(resource.sensitivity) : ''}</h3>
      <p class="card-sub">${missing
        ? 'This resource has not been created yet. Ask an Admin to add it under Resources & Access Policies.'
        : 'Access has not been granted for this session yet.'}</p>
      ${missing ? '' : `
        <button class="btn" onclick="runGateVerification('${esc(resourceName).replace(/'/g, "\\'")}')">Run verification</button>
        <div id="gate-pipeline-run" class="pipeline-req"></div>
        <div id="gate-result"></div>
      `}
    </div>`;
}

function runGateVerification(resourceName) {
  const resource = DB.resources.find(r => r.name === resourceName);
  if (!resource) { toast('Resource missing', 'Ask an Admin to create this resource first.', 'error'); return; }

  const evalResult = evaluateAccess(session.user, session.deviceTrusted, resource);
  document.getElementById('gate-result').innerHTML = '';

  runPipelineAnim('gate-pipeline-run', evalResult.granted, () => {
    const req = {
      id: DB.nextReqId++, user: session.user.username, userName: session.user.name, role: session.user.role,
      resourceId: resource.id, resourceName: resource.name, time: nowStr(),
      automatedResult: evalResult.granted ? 'granted' : 'denied', reason: evalResult.reason,
      manualReview: false, manualStatus: null,
    };
    DB.accessRequests.unshift(req);
    addLog(session.user, `Access request: ${resource.name}`, evalResult.granted ? 'granted' : 'denied', evalResult.reason);

    const box = document.getElementById('gate-result');
    box.innerHTML = `<div class="result-box ${evalResult.granted ? 'granted' : 'denied'}">
      <div>
        <h4>${evalResult.granted ? '✔ Access granted' : '✕ Access denied'}</h4>
        <p>${esc(evalResult.reason)}</p>
      </div>
    </div>`;

    if (evalResult.granted) {
      gateGrantedThisSession.add(resourceName); // unlocks this session only — resets on next login/reload
      setTimeout(() => { render(); }, 900);
    }
  });
}

const _renderBeforeGate = render;
render = function () {
  if (currentView === 'attendance' || currentView === 'grades') {
    const resourceName = requiredResourceFor(currentView);
    if (resourceName && !hasGrantedAccess(resourceName)) {
      const c = document.getElementById('content');
      c.innerHTML = accessGateHtml(resourceName, PAGE_META[currentView].title);
      buildNav();
      return;
    }
  }
  _renderBeforeGate();
};

/* ============ Custom detail view for the "Attendance Records" resource ============
   script.js's openResourceDetail() has a lookup table of resource name -> display
   function (showStudentRecordsDatabase, showGradeManagementSystem, etc). Rather than
   editing that table directly, we wrap the whole function: check for our resource
   first, and fall through to the original for everything else, completely unchanged. */

function showAttendanceRecordsResource(resource) {
  addLog(session.user, `Opened ${resource.name}`, 'granted', `Viewed by ${session.user.role}`);
  document.getElementById('academic-modal-content').innerHTML = `
    <h2 style="font-family:var(--font-display);margin:0 0 4px 0;">${esc(resource.name)}</h2>
    <p style="color:var(--text-faint);font-size:12.5px;margin:0 0 16px 0;">Loading student attendance…</p>`;
  document.getElementById('academic-modal').classList.remove('hidden');
  loadAttendanceRecordsResourceData(resource);
}

async function loadAttendanceRecordsResourceData(resource) {
  const box = document.getElementById('academic-modal-content');
  try {
    const courses = session.user.role === 'Admin'
      ? (await apiGet('/api/courses')).courses
      : (await apiGet(`/api/courses/faculty/${session.user.id}`)).courses;

    if (!courses.length) {
      box.innerHTML = `<h2 style="font-family:var(--font-display);margin:0 0 4px 0;">${esc(resource.name)}</h2>
        <div class="empty-state">No courses found yet.</div>`;
      return;
    }

    let rowsHtml = '';
    for (const course of courses) {
      const { enrollments } = await apiGet(`/api/enrollments/course/${course.id}`);
      for (const e of enrollments) {
        const s = e.student;
        const att = await apiGet(`/api/attendance/student/${s.id}/course/${course.id}`);
        const pct = att.percentage === null ? '—' : att.percentage + '%';
        rowsHtml += `<tr>
          <td class="strong">${esc(s.name)}</td>
          <td>${esc(course.name)} <span class="card-sub">(${esc(course.code)})</span></td>
          <td>${att.present}</td><td>${att.late}</td><td>${att.absent}</td>
          <td>${pct}</td>
        </tr>`;
      }
    }

    box.innerHTML = `
      <h2 style="font-family:var(--font-display);margin:0 0 4px 0;">${esc(resource.name)}</h2>
      <p style="color:var(--text-faint);font-size:12.5px;margin:0 0 16px 0;">Sensitivity: ${esc(resource.sensitivity)} · Allowed roles: ${resource.roles.join(', ')}</p>
      <table><thead><tr><th>Student</th><th>Course</th><th>Present</th><th>Late</th><th>Absent</th><th>Attendance %</th></tr></thead>
      <tbody>${rowsHtml || '<tr><td colspan="6" style="color:var(--text-faint);">No enrolled students yet.</td></tr>'}</tbody>
      </table>`;
  } catch (err) {
    box.innerHTML = `<h2 style="font-family:var(--font-display);margin:0 0 4px 0;">${esc(resource.name)}</h2>
      <div class="empty-state" style="color:var(--danger);">Could not load attendance data: ${esc(err.message)}</div>`;
  }
}

async function loadGradeManagementResourceData(resource) {
  const box = document.getElementById('academic-modal-content');
  try {
    const courses = session.user.role === 'Admin'
      ? (await apiGet('/api/courses')).courses
      : (await apiGet(`/api/courses/faculty/${session.user.id}`)).courses;

    if (!courses.length) {
      box.innerHTML = `<h2 style="font-family:var(--font-display);margin:0 0 4px 0;">${esc(resource.name)}</h2>
        <div class="empty-state">No courses found yet.</div>`;
      return;
    }

    const isFaculty = session.user.role === 'Faculty';
    let rowsHtml = '';
    for (const course of courses) {
      const { enrollments } = await apiGet(`/api/enrollments/course/${course.id}`);
      for (const e of enrollments) {
        const s = e.student;
        const g = await apiGet(`/api/grades/student/${s.id}/course/${course.id}`);
        if (!g.grades.length) {
          rowsHtml += `<tr>
            <td class="strong">${esc(s.name)}</td>
            <td>${esc(course.name)} <span class="card-sub">(${esc(course.code)})</span></td>
            <td colspan="2" style="color:var(--text-faint);">No grades recorded yet.</td>
            ${isFaculty ? '<td></td>' : ''}
          </tr>`;
          continue;
        }
        g.grades.forEach(row => {
          rowsHtml += `<tr data-grade-id="${row.id}">
            <td class="strong">${esc(s.name)}</td>
            <td>${esc(course.name)} <span class="card-sub">(${esc(course.code)})</span></td>
            <td>${esc(row.exam_type)}</td>
            <td>
              <span class="grade-view-mode">${row.marks}/${row.max_marks}</span>
              <span class="grade-edit-mode" style="display:none;">
                <input type="number" min="0" class="grade-edit-marks" value="${row.marks}" style="width:60px;">/<input type="number" min="1" class="grade-edit-max" value="${row.max_marks}" style="width:60px;">
              </span>
            </td>
            ${isFaculty ? `
              <td>
                <span class="grade-view-mode">
                  <button class="btn small secondary" onclick="startEditGrade(${row.id})">Edit</button>
                  <button class="btn small danger-btn" onclick="deleteGrade(${row.id}, ${course.id}, '${s.id}')">Delete</button>
                </span>
                <span class="grade-edit-mode" style="display:none;">
                  <button class="btn small" onclick="saveEditGrade(${row.id})">Save</button>
                  <button class="btn small secondary" onclick="cancelEditGrade(${row.id})">Cancel</button>
                </span>
              </td>` : ''}
          </tr>`;
        });
      }
    }

    box.innerHTML = `
      <h2 style="font-family:var(--font-display);margin:0 0 4px 0;">${esc(resource.name)}</h2>
      <p style="color:var(--text-faint);font-size:12.5px;margin:0 0 16px 0;">Sensitivity: ${esc(resource.sensitivity)} · Allowed roles: ${resource.roles.join(', ')}${isFaculty ? ' · You can edit or delete grades for your own courses.' : ''}</p>
      <table><thead><tr><th>Student</th><th>Course</th><th>Exam</th><th>Marks</th>${isFaculty ? '<th>Actions</th>' : ''}</tr></thead>
      <tbody>${rowsHtml || `<tr><td colspan="${isFaculty ? 5 : 4}" style="color:var(--text-faint);">No enrolled students yet.</td></tr>`}</tbody>
      </table>`;
  } catch (err) {
    box.innerHTML = `<h2 style="font-family:var(--font-display);margin:0 0 4px 0;">${esc(resource.name)}</h2>
      <div class="empty-state" style="color:var(--danger);">Could not load grade data: ${esc(err.message)}</div>`;
  }
}

function startEditGrade(gradeId) {
  const row = document.querySelector(`tr[data-grade-id="${gradeId}"]`);
  row.querySelectorAll('.grade-view-mode').forEach(el => el.style.display = 'none');
  row.querySelectorAll('.grade-edit-mode').forEach(el => el.style.display = 'inline-block');
}

function cancelEditGrade(gradeId) {
  const row = document.querySelector(`tr[data-grade-id="${gradeId}"]`);
  row.querySelectorAll('.grade-edit-mode').forEach(el => el.style.display = 'none');
  row.querySelectorAll('.grade-view-mode').forEach(el => el.style.display = 'inline-block');
}

async function saveEditGrade(gradeId) {
  const row = document.querySelector(`tr[data-grade-id="${gradeId}"]`);
  const marks = row.querySelector('.grade-edit-marks').value;
  const maxMarks = row.querySelector('.grade-edit-max').value;
  try {
    const res = await fetch(`${BACKEND_URL}/api/grades/${gradeId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ marks, maxMarks, requesterRole: session.user.role, requesterId: session.user.id }),
    });
    const data = await res.json();
    if (!res.ok || data.success === false) throw new Error(data.error || 'Update failed');
    toast('Grade updated', `${marks}/${maxMarks} saved.`, 'success');
    row.querySelector('.grade-view-mode').textContent = `${marks}/${maxMarks}`;
    cancelEditGrade(gradeId);
  } catch (err) {
    toast('Failed to update', err.message, 'error');
  }
}

async function deleteGrade(gradeId, courseId, studentId) {
  if (!confirm('Delete this grade entry? This cannot be undone.')) return;
  try {
    const res = await fetch(`${BACKEND_URL}/api/grades/${gradeId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requesterRole: session.user.role, requesterId: session.user.id }),
    });
    const data = await res.json();
    if (!res.ok || data.success === false) throw new Error(data.error || 'Delete failed');
    toast('Grade deleted', '', 'success');
    document.querySelector(`tr[data-grade-id="${gradeId}"]`).remove();
  } catch (err) {
    toast('Failed to delete', err.message, 'error');
  }
}

function showGradeManagementResource(resource) {
  addLog(session.user, `Opened ${resource.name}`, 'granted', `Viewed by ${session.user.role}`);
  document.getElementById('academic-modal-content').innerHTML = `
    <h2 style="font-family:var(--font-display);margin:0 0 4px 0;">${esc(resource.name)}</h2>
    <p style="color:var(--text-faint);font-size:12.5px;margin:0 0 16px 0;">Loading grades…</p>`;
  document.getElementById('academic-modal').classList.remove('hidden');
  loadGradeManagementResourceData(resource);
}

const _openResourceDetailBeforeGate = openResourceDetail;
openResourceDetail = function (resourceId) {
  const resource = DB.resources.find(r => r.id === resourceId);
  if (resource && resource.name === 'Attendance Records') {
    showAttendanceRecordsResource(resource);
    return;
  }
  if (resource && resource.name === 'Grade Management System') {
    showGradeManagementResource(resource);
    return;
  }
  _openResourceDetailBeforeGate(resourceId);
};