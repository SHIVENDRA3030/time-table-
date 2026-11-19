const express = require('express');
const router = express.Router();
const { sealTimetableQuery } = require('../services/realtimeService');
const { isEditor } = require('../middleware/rbac');
const db = require('../db');

// POST /api/realtime/:viewType/:resourceId — returns a sealed live query for the
// timetable of the requested section/faculty/room. Auth happens in server.js;
// the sealed query is the authorization for the subscription itself.
router.post('/:viewType/:resourceId', async (req, res) => {
    try {
        // Viewers may only subscribe to published sections' live queries.
        if (req.params.viewType === 'section' && !isEditor(req)) {
            const { rows } = await db.query('SELECT status FROM sections WHERE id = $1', [req.params.resourceId]);
            if (rows[0] && rows[0].status !== 'published') {
                return res.status(403).json({ error: 'This timetable is not published yet.' });
            }
        }
        const sealed = await sealTimetableQuery(req.params.viewType, req.params.resourceId);
        res.json(sealed);
    } catch (error) {
        res.status(error.status || 500).json({ error: error.message });
    }
});

module.exports = router;
