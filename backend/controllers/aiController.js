// Calls the Neon AI Gateway (OpenAI-compatible) with the branch-scoped credential.
const GATEWAY_BASE_URL = process.env.NEON_AI_GATEWAY_BASE_URL;
const GATEWAY_TOKEN = process.env.NEON_AI_GATEWAY_TOKEN;
const DEFAULT_MODEL = process.env.NEON_AI_MODEL || 'gpt-5-mini';

if (!GATEWAY_BASE_URL || !GATEWAY_TOKEN) {
    throw new Error(
        'Missing NEON_AI_GATEWAY_BASE_URL / NEON_AI_GATEWAY_TOKEN. Run `neon deploy` in the project root to provision the AI Gateway.'
    );
}

const gatewayHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${GATEWAY_TOKEN}`
};

// GET /api/ai/models — live, branch-scoped model catalog
const listModels = async (req, res) => {
    try {
        const response = await fetch(`${GATEWAY_BASE_URL}/v1/models`, { headers: gatewayHeaders });
        const body = await response.json();
        if (!response.ok) {
            return res.status(response.status).json(body);
        }
        res.json(body);
    } catch (error) {
        res.status(502).json({ error: `AI Gateway request failed: ${error.message}` });
    }
};

const buildWorkloadSummary = async (db) => {
    const { rows } = await db.query(`
        SELECT sec.name AS section, sub.name AS subject, fac.name AS faculty,
               COALESCE(rm.room_number, 'No room') AS room, w.lectures_per_week
        FROM workloads w
        LEFT JOIN sections sec ON sec.id = w.section_id
        LEFT JOIN subjects sub ON sub.id = w.subject_id
        LEFT JOIN faculty fac ON fac.id = w.faculty_id
        LEFT JOIN rooms rm ON rm.id = w.room_id
        ORDER BY sec.name, fac.name
    `);

    const { rows: entryCounts } = await db.query(`
        SELECT fac.name AS faculty, COUNT(*)::int AS scheduled
        FROM timetable_entries te
        LEFT JOIN faculty fac ON fac.id = te.faculty_id
        GROUP BY fac.name
    `);

    return { workloads: rows, scheduledByFaculty: entryCounts };
};

// POST /api/ai/insights — summarizes scheduling load and suggests improvements
const getInsights = async (req, res) => {
    try {
        const db = require('../db');
        const summary = await buildWorkloadSummary(db);

        const prompt = `You are a university timetable advisor. Here is the teaching workload data as JSON:
${JSON.stringify(summary)}

Write a short analysis (max 180 words):
1. Which faculty carry the heaviest and lightest loads (compare lectures_per_week totals and what is already scheduled).
2. One concrete suggestion to balance the schedule.`;

        const response = await fetch(`${GATEWAY_BASE_URL}/v1/chat/completions`, {
            method: 'POST',
            headers: gatewayHeaders,
            body: JSON.stringify({
                model: DEFAULT_MODEL,
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 400
            })
        });

        const body = await response.json();

        if (!response.ok) {
            // Surface gateway errors (e.g. no credits) with their own status
            return res.status(response.status).json({
                error: body.error?.message || 'AI Gateway request failed',
                gateway: body
            });
        }

        res.json({
            model: body.model || DEFAULT_MODEL,
            insight: body.choices?.[0]?.message?.content ?? ''
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

module.exports = { listModels, getInsights };
