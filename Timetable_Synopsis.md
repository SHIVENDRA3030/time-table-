Final Year Project Synopsis
B.Tech. (CSE) Session 2026-27
PROJECT TOPIC: AUTOMATED TIMETABLE MANAGEMENT AND SCHEDULING SYSTEM
Group No.: G360
Academic Term: 2026–2027 (VII Semester)
Project Area: Web Development & Algorithm Design
Project Mentor: Chitranjan Prasad Sah, Assistant Professor
Completion Deadline: March 2027
Project Members:
1. Bhaskar Kumar (AD-20 / Univ Roll No: 2315000604)
2. Arpit Singh (AD-65 / Univ Roll No: 2315000430)
3. Jai Kundu (AC-31 / Univ Roll No: 2315001005)
4. Yash Pratap Singh Bhadauriya (W-68 / Univ Roll No: 2315002540)
5. Abhishek Upadhyay (Univ Roll No: 2315000079)

ABOUT THE PROJECT

Academic institutions face significant challenges in creating and managing conflict-free timetables for multiple sections, faculty, subjects, and rooms. Manual timetable creation is time-consuming, error-prone, and difficult to maintain when constraints change. The Automated Timetable Management and Scheduling System addresses this problem by providing a comprehensive web-based platform that combines automated schedule generation with intuitive manual editing capabilities.

The system uses a backtracking-based constraint satisfaction algorithm to generate optimal timetables from workload requirements (lectures per week per section-subject-faculty combination). It automatically detects and prevents conflicts across three dimensions: faculty double-booking, room double-booking, and section double-booking. The generated schedule respects existing manual entries and only fills gaps, preserving human-made decisions.

A sophisticated Excel parser handles complex institutional timetable formats, recognizing day/time grids, subject codes, faculty assignments, room numbers, lab practical hours, and sub-section groupings. The parser supports dry-run preview mode, duplicate detection with intelligent room backfilling, and data quality reporting including missing room detection and online class identification.

The React-based frontend provides a responsive dashboard with real-time statistics, room utilization and faculty load analytics, and a data quality audit panel. The timetable explorer supports three query views (by Section, Faculty, or Room) with fuzzy search, day filtering, and an interactive weekly grid. The grid supports drag-and-drop rescheduling, inline editing via modal, and real-time conflict validation. A mobile-responsive accordion view ensures usability on all devices.

Authentication is handled via Clerk, providing secure user management without custom auth infrastructure. Data persistence uses Supabase (PostgreSQL) with a normalized schema covering programs, sections, subjects, faculty, rooms, time slots, workloads, and timetable entries.

MOTIVATION AND SCOPE

Most academic institutions still rely on manual timetable creation using spreadsheets or basic tools that lack conflict detection, automated generation, and bulk import capabilities. Commercial scheduling software is often expensive, rigid, and requires dedicated administrators. This project fills the gap by delivering a free, open-architecture solution that combines the flexibility of manual editing with the power of algorithmic generation and bulk data import.

The scope includes: automated timetable generation using constraint satisfaction, Excel bulk import with format-tolerant parsing, three-dimensional conflict detection and prevention, multi-view timetable query (section/faculty/room), drag-and-drop manual editing with real-time validation, data quality auditing, and secure authentication. The system is designed as a final-year major project because it integrates full-stack web development, algorithm design, complex data parsing, database design, and user experience considerations into one working and tested system.

OBJECTIVES

• To design an automated timetable generator that produces conflict-free schedules from workload requirements using a backtracking algorithm with randomization for schedule diversity.
• To build a robust Excel parser that handles real-world institutional timetable formats including merged cells, sub-sections, lab practicals, and varied time notations.
• To implement comprehensive conflict detection across faculty, rooms, and sections for both automated generation and manual operations.
• To provide an intuitive web interface with three query perspectives, fuzzy search, day filtering, and drag-and-drop editing.
• To enable data quality monitoring through missing room detection, online class identification, and import audit trails.
• To ensure low operational cost by using serverless authentication (Clerk) and managed database (Supabase) with free-tier eligibility.

EXISTING APPROACHES AND GAP

Existing timetable tools fall into two categories: basic spreadsheet templates that offer no automation or conflict checking, and commercial ERP modules that are costly, require extensive configuration, and lock data into proprietary formats. Most university-built solutions are either simple CRUD interfaces without generation, or generation engines without usable interfaces. The gap is a unified system that combines algorithmic generation, format-flexible bulk import, interactive editing, and quality analytics in a single accessible web application.

INNOVATION

• Hybrid generation and editing: The backtracking generator respects existing manual entries and only schedules unscheduled workloads, enabling iterative refinement.
• Format-tolerant Excel parser: Handles multiple header styles, time formats (24-hour, AM/PM, cross-midnight), subject codes with LAB suffixes, room patterns (ABI-311, ABVIII-205, named labs), sub-section groupings, and batch markers.
• Intelligent duplicate handling: On re-import, detects duplicates and backfills missing room assignments instead of failing or creating conflicts.
• Three-perspective query engine: Instant switching between section, faculty, and room views with shared search and filter state.
• Data quality audit: Real-time dashboard metrics for missing rooms, online vs. non-online gaps, and parser-sourced quality snapshots.
• Mobile-first responsive grid: Accordion-style day expansion on mobile, full data table on desktop, with identical drag-drop and edit capabilities.

EXPECTED OUTCOME

The system should successfully parse a sample institutional Excel workbook containing multiple section sheets, populate the database with programs, sections, subjects, faculty, rooms, time slots, and timetable entries, and generate a complete conflict-free weekly schedule for all sections. The auto-generator should schedule all workload requirements within the available time slots. The dashboard should display accurate statistics, utilization charts, and quality metrics. The timetable explorer should allow instant query by any section, faculty, or room with fuzzy search. Drag-and-drop rescheduling should validate conflicts in real-time. The project should demonstrate end-to-end workflow from Excel upload to published timetable with zero manual database operations.

PROJECT PLANNING AND METHODOLOGY

Work Breakdown Structure and Gantt Chart timeline (September 2026 – March 2027):

Phase 1 (Sep–Oct 2026): Requirements analysis, database schema design, Supabase project setup, Clerk authentication integration, basic Express API skeleton with CORS and auth middleware.

Phase 2 (Nov–Dec 2026): Core CRUD APIs for programs, sections, subjects, faculty, rooms, time slots. Workload management API. Conflict detection service. Timetable entry CRUD with conflict validation.

Phase 3 (Jan 2027): Backtracking timetable generator with randomization, workload expansion, and bulk insert. Integration with existing entries preservation.

Phase 4 (Feb 2027): Excel parser development: schedule header detection, time range parsing, subject code extraction, room number extraction, faculty mapping, sub-section handling, lab practical spanning, global/local catalog merging, deduplication. Dry-run preview and quality summary endpoints.

Phase 5 (Mar 2027): React frontend: Dashboard with stats, charts, quality audit. Timetables page with three views, fuzzy search, day filter, desktop grid, mobile accordion, drag-drop, edit modal. Manage Data page with six tabs. Upload page with drag-drop, dry-run toggle, results preview, danger zone. Clerk auth integration, protected routes, responsive Tailwind styling. Testing, bug fixes, documentation, final demo preparation.

TOOLS AND ENVIRONMENT

• Programming Languages: JavaScript (Node.js backend, React frontend)
• Backend Framework: Express.js (v5)
• Frontend Framework: React 19 with Vite 7
• Styling: Tailwind CSS 4 with custom design system (CSS variables)
• Database: Supabase (PostgreSQL) with Row Level Security
• Authentication: Clerk (React SDK + Node SDK)
• File Parsing: xlsx (SheetJS) for Excel .xlsx/.xls
• Deployment Target: Vercel (frontend), Render/Railway (backend) — both free-tier compatible
• Development: Visual Studio Code, Git, GitHub, Node.js 20+, npm
• Hardware: Any laptop or desktop with at least 4 GB RAM and a stable internet connection

Academic Session: 2026–2027
Mathura, Uttar Pradesh
Signature of Project Mentor: ______________________
GLA UNIVERSITY, MATHURA DEPARTMENT OF COMPUTER ENGINEERING & APPLICATIONS