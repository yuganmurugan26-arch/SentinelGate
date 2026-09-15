/**
 * SentinelGate — Grades routes
 * -------------------------------------------------------------
 * Same isolated-file pattern as academic.js. This is deliberately
 * built WITHOUT the real-auth (requireAuth/token) changes for now,
 * to match academic.js's current reverted state — both will be
 * upgraded to real auth together once the full feature set exists.
 *
 * To use: in server.js, after the academic.js line, add:
 *   const gradesRoutes = require('./grades')(supabase);
 *   app.use('/api', gradesRoutes);
 */

const express = require('express');

module.exports = function (supabase) {
  const router = express.Router();

  function requireSupabase(req, res, next) {
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase is not configured on this server.' });
    }
    next();
  }
  router.use(requireSupabase);

  // POST /api/grades — enter or update a grade (same student+course+examType = update, not duplicate)
  // Body: { studentId, courseId, examType, marks, maxMarks, enteredBy, requesterRole }
  router.post('/grades', async (req, res) => {
    const { studentId, courseId, examType, marks, maxMarks, enteredBy, requesterRole } = req.body || {};

    if (!['Admin', 'Faculty'].includes(requesterRole)) {
      return res.status(403).json({ success: false, error: 'Only Admin or Faculty can enter grades.' });
    }
    if (!studentId || !courseId || !examType || marks === undefined || maxMarks === undefined) {
      return res.status(400).json({ success: false, error: 'studentId, courseId, examType, marks, and maxMarks are required.' });
    }
    const marksNum = Number(marks);
    const maxMarksNum = Number(maxMarks);
    if (Number.isNaN(marksNum) || Number.isNaN(maxMarksNum) || maxMarksNum <= 0 || marksNum < 0 || marksNum > maxMarksNum) {
      return res.status(400).json({ success: false, error: 'marks must be a number between 0 and maxMarks.' });
    }

    // If Faculty (not Admin), confirm they actually own this course before allowing the write.
    if (requesterRole === 'Faculty') {
      const { data: course, error: courseErr } = await supabase
        .from('courses')
        .select('faculty_id')
        .eq('id', courseId)
        .single();
      if (courseErr) return res.status(500).json({ success: false, error: courseErr.message });
      if (!course || String(course.faculty_id) !== String(enteredBy)) {
        return res.status(403).json({ success: false, error: 'You can only enter grades for your own courses.' });
      }
    }

    const { data, error } = await supabase
      .from('grades')
      .upsert(
        {
          student_id: studentId,
          course_id: courseId,
          exam_type: examType,
          marks: marksNum,
          max_marks: maxMarksNum,
          entered_by: enteredBy || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'student_id,course_id,exam_type' }
      )
      .select()
      .single();
    if (error) return res.status(500).json({ success: false, error: error.message });
    res.json({ success: true, grade: data });
  });

  // GET /api/grades/student/:studentId/course/:courseId — one student's full grade breakdown for one course
  router.get('/grades/student/:studentId/course/:courseId', async (req, res) => {
    const { studentId, courseId } = req.params;
    const { data, error } = await supabase
      .from('grades')
      .select('id, exam_type, marks, max_marks, updated_at')
      .eq('student_id', studentId)
      .eq('course_id', courseId)
      .order('created_at');
    if (error) return res.status(500).json({ success: false, error: error.message });

    const totalMarks = data.reduce((sum, g) => sum + Number(g.marks), 0);
    const totalMax = data.reduce((sum, g) => sum + Number(g.max_marks), 0);
    const percentage = totalMax ? Math.round((totalMarks / totalMax) * 1000) / 10 : null;

    res.json({ success: true, grades: data, totalMarks, totalMax, percentage });
  });

  // GET /api/grades/course/:courseId?examType=Midterm — every student's grade for one course
  // (Faculty view — examType filter optional; omit it to see all exam types at once, e.g. for Admin overview)
  router.get('/grades/course/:courseId', async (req, res) => {
    const { courseId } = req.params;
    const { examType } = req.query;

    let query = supabase
      .from('grades')
      .select('id, student_id, exam_type, marks, max_marks, student:users!grades_student_id_fkey(id, name, username)')
      .eq('course_id', courseId);
    if (examType) query = query.eq('exam_type', examType);

    const { data, error } = await query;
    if (error) return res.status(500).json({ success: false, error: error.message });
    res.json({ success: true, grades: data });
  });

  // PUT /api/grades/:id — edit an existing grade entry. Faculty-only (not Admin), and only
  // for their own course — matching the requirement that editing is a Faculty-specific power.
  // Body: { marks, maxMarks, requesterRole, requesterId }
  router.put('/grades/:id', async (req, res) => {
    const { id } = req.params;
    const { marks, maxMarks, requesterRole, requesterId } = req.body || {};

    if (requesterRole !== 'Faculty') {
      return res.status(403).json({ success: false, error: 'Only Faculty can edit grades.' });
    }
    if (marks === undefined || maxMarks === undefined) {
      return res.status(400).json({ success: false, error: 'marks and maxMarks are required.' });
    }
    const marksNum = Number(marks);
    const maxMarksNum = Number(maxMarks);
    if (Number.isNaN(marksNum) || Number.isNaN(maxMarksNum) || maxMarksNum <= 0 || marksNum < 0 || marksNum > maxMarksNum) {
      return res.status(400).json({ success: false, error: 'marks must be a number between 0 and maxMarks.' });
    }

    // Confirm this grade belongs to a course this faculty actually teaches.
    const { data: existing, error: fetchErr } = await supabase
      .from('grades')
      .select('course_id')
      .eq('id', id)
      .single();
    if (fetchErr) return res.status(404).json({ success: false, error: 'Grade entry not found.' });

    const { data: course, error: courseErr } = await supabase
      .from('courses')
      .select('faculty_id')
      .eq('id', existing.course_id)
      .single();
    if (courseErr) return res.status(500).json({ success: false, error: courseErr.message });
    if (!course || String(course.faculty_id) !== String(requesterId)) {
      return res.status(403).json({ success: false, error: 'You can only edit grades for your own courses.' });
    }

    const { data, error } = await supabase
      .from('grades')
      .update({ marks: marksNum, max_marks: maxMarksNum, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) return res.status(500).json({ success: false, error: error.message });
    res.json({ success: true, grade: data });
  });

  // DELETE /api/grades/:id — Faculty-only, own course only.
  // Body: { requesterRole, requesterId }
  router.delete('/grades/:id', async (req, res) => {
    const { id } = req.params;
    const { requesterRole, requesterId } = req.body || {};

    if (requesterRole !== 'Faculty') {
      return res.status(403).json({ success: false, error: 'Only Faculty can delete grades.' });
    }

    const { data: existing, error: fetchErr } = await supabase
      .from('grades')
      .select('course_id')
      .eq('id', id)
      .single();
    if (fetchErr) return res.status(404).json({ success: false, error: 'Grade entry not found.' });

    const { data: course, error: courseErr } = await supabase
      .from('courses')
      .select('faculty_id')
      .eq('id', existing.course_id)
      .single();
    if (courseErr) return res.status(500).json({ success: false, error: courseErr.message });
    if (!course || String(course.faculty_id) !== String(requesterId)) {
      return res.status(403).json({ success: false, error: 'You can only delete grades for your own courses.' });
    }

    const { error } = await supabase.from('grades').delete().eq('id', id);
    if (error) return res.status(500).json({ success: false, error: error.message });
    res.json({ success: true });
  });

  return router;
};