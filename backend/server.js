const express = require('express');
const cors = require('cors');
const { ClerkExpressWithAuth } = require('@clerk/clerk-sdk-node');
const dotenv = require('dotenv');

dotenv.config({ quiet: true });

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Public routes (no auth)
app.get('/', (req, res) => {
    res.send('Timetable Management System API');
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// Attach Clerk auth context only for API routes
app.use('/api', ClerkExpressWithAuth());

// Routes
// Helper to require auth
const requireAuth = (req, res, next) => {
    if (!req.auth || !req.auth.userId) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    next();
};

app.use('/api/timetable', requireAuth, require('./routes/timetableRoutes'));
app.use('/api/programs', requireAuth, require('./routes/programSectionRoutes'));
app.use('/api/resources', requireAuth, require('./routes/subjectRoutes'));
app.use('/api/upload', requireAuth, require('./routes/uploadRoutes'));
// app.use('/api/auth', require('./routes/authRoutes')); // Deprecated: using Clerk

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack || err);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: 'Something broke!' });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
