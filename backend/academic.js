/**
 * SentinelGate — Academic routes (courses, enrollments, attendance)
 * -------------------------------------------------------------
 * Kept in its own file, separate from server.js, so this addition
 * is easy to review/remove independently if something goes wrong.
 *
 * To use: in server.js, add near the top (after `supabase` is created):
 *   const academicRoutes = require('./academic')(supabase);
 *   app.use('/api', academicRoutes);
 */

const express = require('express');

module.exports = function (supabase) {
  const router = express.Router();

  // Every route here needs Supabase configured — bail early with a clear
  // error instead of a confusing crash if it's somehow not set up.
  function requireSupabase(req, res, next) {
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase is not configured on this server.' });
    }
    next();
  }
  router.use(requireSupabase);

  /* ============================================================
     COURSES
     ============================================================ */

  // GET /api/courses — list all courses (any logged-in role can see the list)
  router.get('/courses', async (req, res) => {
    const { data, error } = await supabase.from('courses').select('*').order('id');
    if (error) return res.status(500).json({ success: false, error: error.message });
    res.json({ success: true, courses: data });
  });

  // GET /api/courses/faculty/:facultyId — courses taught by one faculty member
  router.get('/courses/faculty/:facultyId', async (req, res) => {
    const { facultyId } = req.params;
    const { data, error } = await supabase.from('courses').select('*').eq('faculty_id', facultyId);
    if (error) return res.status(500).json({ success: false, error: error.message });
    res.json({ success: true, courses: data });
  });

  // POST /api/courses — create a course
  // Body: { name, code, facultyId, semester, requesterRole }
  // Only Admin can create courses — enforced here, not just hidden in the UI.
  router.post('/courses', async (req, res) => {
    const { name, code, facultyId, semester, requesterRole } = req.body || {};
    if (requesterRole !== 'Admin') {
      return res.status(403).json({ success: false, error: 'Only Admin can create courses.' });
    }
    if (!name || !code) {
      return res.status(400).json({ success: false, error: 'name and code are required.' });
    }
    const { data, error } = await supabase
      .from('courses')
      .insert({ name, code, faculty_id: facultyId || null, semester: semester || null })
      .select()
      .single();
    if (error) return res.status(500).json({ success: false, error: error.message });
    res.json({ success: true, course: data });
  });

  /* ============================================================
     ENROLLMENTS
     ============================================================ */

  // GET /api/enrollments/student/:studentId — courses a student is enrolled in
  router.get('/enrollments/student/:studentId', async (req, res) => {
    const { studentId } = req.params;
    const { data, error } = await supabase
      .from('enrollments')
      .select('id, course:courses(id, name, code, semester)')
      .eq('student_id', studentId);
    if (error) return res.status(500).json({ success: false, error: error.message });
    res.json({ success: true, enrollments: data });
  });

  // GET /api/enrollments/course/:courseId — students enrolled in a course
  router.get('/enrollments/course/:courseId', async (req, res) => {
    const { courseId } = req.params;
    const { data, error } = await supabase
      .from('enrollments')
      .select('id, student:users(id, name, username)')
      .eq('course_id', courseId);
    if (error) return res.status(500).json({ success: false, error: error.message });
    res.json({ success: true, enrollments: data });
  });

  // POST /api/enrollments — enroll a student in a course
  // Body: { studentId, courseId, requesterRole }
  // Admin or the course's own Faculty can enroll students.
  router.post('/enrollments', async (req, res) => {
    const { studentId, courseId, requesterRole } = req.body || {};
    if (!['Admin', 'Faculty'].includes(requesterRole)) {
      return res.status(403).json({ success: false, error: 'Only Admin or Faculty can enroll students.' });
    }
    if (!studentId || !courseId) {
      return res.status(400).json({ success: false, error: 'studentId and courseId are required.' });
    }
    const { data, error } = await supabase
      .from('enrollments')
      .insert({ student_id: studentId, course_id: courseId })
      .select()
      .single();
    if (error) return res.status(500).json({ success: false, error: error.message });
    res.json({ success: true, enrollment: data });
  });

  /* ============================================================
     ATTENDANCE
     ============================================================ */

  // POST /api/attendance — mark attendance for one student, one course, one date
  // Body: { studentId, courseId, date, status, markedBy, requesterRole }
  // Only Faculty (for their own course) or Admin can mark attendance.
  router.post('/attendance', async (req, res) => {
    const { studentId, courseId, date, status, markedBy, requesterRole } = req.body || {};
    if (!['Admin', 'Faculty'].includes(requesterRole)) {
      return res.status(403).json({ success: false, error: 'Only Admin or Faculty can mark attendance.' });
    }
    if (!studentId || !courseId || !date || !status) {
      return res.status(400).json({ success: false, error: 'studentId, courseId, date, and status are required.' });
    }
    if (!['present', 'absent', 'late'].includes(status)) {
      return res.status(400).json({ success: false, error: "status must be 'present', 'absent', or 'late'." });
    }

    // If Faculty (not Admin), confirm they actually own this course before allowing the write.
    if (requesterRole === 'Faculty') {
      const { data: course, error: courseErr } = await supabase
        .from('courses')
        .select('faculty_id')
        .eq('id', courseId)
        .single();
      if (courseErr) return res.status(500).json({ success: false, error: courseErr.message });
      if (!course || String(course.faculty_id) !== String(markedBy)) {
        return res.status(403).json({ success: false, error: 'You can only mark attendance for your own courses.' });
      }
    }

    // upsert so re-marking the same student/course/date updates instead of erroring
    const { data, error } = await supabase
      .from('attendance_records')
      .upsert(
        { student_id: studentId, course_id: courseId, date, status, marked_by: markedBy || null },
        { onConflict: 'student_id,course_id,date' }
      )
      .select()
      .single();
    if (error) return res.status(500).json({ success: false, error: error.message });
    res.json({ success: true, record: data });
  });

  // GET /api/attendance/student/:studentId/course/:courseId — one student's attendance % for one course
  router.get('/attendance/student/:studentId/course/:courseId', async (req, res) => {
    const { studentId, courseId } = req.params;
    const { data, error } = await supabase
      .from('attendance_records')
      .select('date, status')
      .eq('student_id', studentId)
      .eq('course_id', courseId)
      .order('date');
    if (error) return res.status(500).json({ success: false, error: error.message });

    const total = data.length;
    const presentCount = data.filter(r => r.status === 'present').length;
    const lateCount = data.filter(r => r.status === 'late').length;
    const absentCount = data.filter(r => r.status === 'absent').length;
    // "late" counts as half credit toward the percentage — student showed up, just not on time.
    const weightedCredit = presentCount + (lateCount * 0.5);
    const percentage = total ? Math.round((weightedCredit / total) * 1000) / 10 : null;

    res.json({
      success: true,
      records: data,
      total,
      present: presentCount,
      late: lateCount,
      absent: absentCount,
      percentage,
    });
  });

  // GET /api/attendance/course/:courseId/date/:date — one course's attendance for one day (faculty view)
  router.get('/attendance/course/:courseId/date/:date', async (req, res) => {
    const { courseId, date } = req.params;
    const { data, error } = await supabase
      .from('attendance_records')
      .select('student_id, status, student:users!attendance_records_student_id_fkey(name, username)')
      .eq('course_id', courseId)
      .eq('date', date);
    if (error) return res.status(500).json({ success: false, error: error.message });
    res.json({ success: true, records: data });
  });

  return router;
};