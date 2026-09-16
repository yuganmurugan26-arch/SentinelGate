/**
 * SentinelGate — Student profile routes (roll no, program)
 * -------------------------------------------------------------
 * Same isolated-file pattern as academic.js and grades.js.
 *
 * To use: in server.js, after the grades.js line, add:
 *   const profileRoutes = require('./profiles')(supabase);
 *   app.use('/api', profileRoutes);
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

  // GET /api/profile/:studentId — returns {rollNo, program}, both null if never set
  router.get('/profile/:studentId', async (req, res) => {
    const { studentId } = req.params;
    const { data, error } = await supabase
      .from('student_profiles')
      .select('roll_no, program')
      .eq('student_id', studentId)
      .maybeSingle();
    if (error) return res.status(500).json({ success: false, error: error.message });
    res.json({ success: true, rollNo: data?.roll_no || null, program: data?.program || null });
  });

  // PUT /api/profile/:studentId — Faculty-only. Body: { rollNo, program, requesterRole }
  router.put('/profile/:studentId', async (req, res) => {
    const { studentId } = req.params;
    const { rollNo, program, requesterRole } = req.body || {};
    if (requesterRole !== 'Faculty') {
      return res.status(403).json({ success: false, error: 'Only Faculty can edit student profile details.' });
    }
    const { data, error } = await supabase
      .from('student_profiles')
      .upsert(
        { student_id: studentId, roll_no: rollNo || null, program: program || null, updated_at: new Date().toISOString() },
        { onConflict: 'student_id' }
      )
      .select()
      .single();
    if (error) return res.status(500).json({ success: false, error: error.message });
    res.json({ success: true, rollNo: data.roll_no, program: data.program });
  });

  // DELETE /api/profile/:studentId — Faculty-only. Clears roll no / program back to blank.
  router.delete('/profile/:studentId', async (req, res) => {
    const { studentId } = req.params;
    const { requesterRole } = req.body || {};
    if (requesterRole !== 'Faculty') {
      return res.status(403).json({ success: false, error: 'Only Faculty can clear student profile details.' });
    }
    const { error } = await supabase.from('student_profiles').delete().eq('student_id', studentId);
    if (error) return res.status(500).json({ success: false, error: error.message });
    res.json({ success: true });
  });

  return router;
};