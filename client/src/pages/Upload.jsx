import React, { useMemo, useState } from 'react';
import api from '../services/api';

const DASHBOARD_QUALITY_KEY = 'timetable-dashboard-quality';

const formatBytes = (bytes) => {
    if (!bytes && bytes !== 0) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let idx = 0;
    while (value >= 1024 && idx < units.length - 1) {
        value /= 1024;
        idx += 1;
    }
    return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
};

const Upload = () => {
    const [file, setFile] = useState(null);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [responseData, setResponseData] = useState(null);
    const [isUploading, setIsUploading] = useState(false);
    const [isDeletingData, setIsDeletingData] = useState(false);
    const [dragActive, setDragActive] = useState(false);
    const [dryRun, setDryRun] = useState(true);
    const [deleteSummary, setDeleteSummary] = useState(null);

    const handleFileSelection = (selectedFile) => {
        if (!selectedFile) return;
        setFile(selectedFile);
        setMessage('');
        setError('');
        setResponseData(null);
    };

    const handleFileChange = (e) => {
        handleFileSelection(e.target.files?.[0] || null);
    };

    const handleDrop = (e) => {
        e.preventDefault();
        setDragActive(false);
        const droppedFile = e.dataTransfer?.files?.[0];
        handleFileSelection(droppedFile);
    };

    const handleUpload = async (e) => {
        e.preventDefault();

        if (!file) {
            setError('Please choose an Excel file first.');
            return;
        }

        const formData = new FormData();
        formData.append('file', file);

        setIsUploading(true);
        setError('');
        setMessage('');

        try {
            const response = await api.post('/upload', formData, {
                headers: {
                    'Content-Type': 'multipart/form-data',
                },
                params: dryRun ? { dryRun: true } : undefined,
            });

            const payload = response.data || {};
            setMessage(payload.message || (dryRun ? 'Dry run completed.' : 'File processed successfully.'));
            setResponseData(payload);
            setDeleteSummary(null);

            if (payload.quality && typeof window !== 'undefined') {
                const snapshot = {
                    ...payload.quality,
                    updatedAt: new Date().toISOString(),
                    source: dryRun ? 'dry-run' : 'upload',
                };
                window.localStorage.setItem(DASHBOARD_QUALITY_KEY, JSON.stringify(snapshot));
            }
        } catch (err) {
            setError('Failed to upload file. ' + (err.response?.data?.error || err.message));
            setResponseData(null);
        } finally {
            setIsUploading(false);
        }
    };

    const handleDeleteDatabase = async () => {
        const confirmed = window.confirm(
            'Delete all timetable database data? This removes programs, sections, subjects, faculty, rooms, slots, and timetable entries.'
        );
        if (!confirmed) return;

        setIsDeletingData(true);
        setError('');
        setMessage('');

        try {
            const response = await api.delete('/upload/database');
            const payload = response.data || {};
            const summary = payload.summary || {};
            const deleted = summary.deleted || null;
            const totalDeleted = Number(summary.totalDeleted) || 0;

            setFile(null);
            setResponseData(null);
            setDeleteSummary(deleted);
            setMessage(`${payload.message || 'Database data deleted.'} Removed ${totalDeleted} rows.`);

            if (typeof window !== 'undefined') {
                window.localStorage.removeItem(DASHBOARD_QUALITY_KEY);
            }
        } catch (err) {
            setError('Failed to delete database data. ' + (err.response?.data?.error || err.message));
        } finally {
            setIsDeletingData(false);
        }
    };

    const summaryCards = useMemo(() => {
        if (!responseData) return [];

        if (responseData.results) {
            return [
                { label: 'Parsed', value: responseData.results.totalParsed ?? 0 },
                { label: 'Inserted', value: responseData.results.inserted ?? 0 },
                { label: 'Updated', value: responseData.results.updated ?? 0 },
                { label: 'Duplicates', value: responseData.results.duplicates ?? 0 },
                { label: 'Failed', value: responseData.results.failed ?? 0 },
            ];
        }

        return [
            { label: 'Parsed', value: responseData.totalParsed ?? 0 },
            { label: 'Sample Rows', value: Array.isArray(responseData.sample) ? responseData.sample.length : 0 },
        ];
    }, [responseData]);

    const sampleRows = Array.isArray(responseData?.sample) ? responseData.sample.slice(0, 6) : [];
    const errorRows = Array.isArray(responseData?.results?.errors) ? responseData.results.errors.slice(0, 8) : [];

    return (
        <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
            <section className="glass-panel p-6 md:p-7">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h2 className="text-2xl">Upload Timetable Excel</h2>
                        <p className="section-subtitle mt-2">
                            Drag and drop semester sheets, preview parse output, then run final insert.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => setDryRun((prev) => !prev)}
                        className={`chip ${dryRun ? 'is-active' : ''}`}
                        title="Toggle dry-run mode"
                    >
                        {dryRun ? 'Dry Run On' : 'Dry Run Off'}
                    </button>
                </div>

                <form onSubmit={handleUpload} className="mt-6 space-y-4">
                    <div
                        onDragEnter={(e) => {
                            e.preventDefault();
                            setDragActive(true);
                        }}
                        onDragOver={(e) => {
                            e.preventDefault();
                            setDragActive(true);
                        }}
                        onDragLeave={(e) => {
                            e.preventDefault();
                            setDragActive(false);
                        }}
                        onDrop={handleDrop}
                        className={`rounded-2xl border-2 border-dashed p-6 transition ${dragActive
                            ? 'border-[var(--accent-600)] bg-[var(--accent-100)]'
                            : 'border-[color:var(--surface-stroke)] bg-[var(--surface-strong)]'}`}
                    >
                        <label className="block cursor-pointer text-sm font-semibold text-[var(--ink-700)]">
                            Select or drop `.xlsx` / `.xls`
                            <input
                                type="file"
                                accept=".xlsx,.xls"
                                onChange={handleFileChange}
                                className="sr-only"
                            />
                        </label>
                        <p className="mt-2 text-sm text-[var(--ink-600)]">
                            The parser recognizes timetable grids with `Day/Time` and `Code` mapping sections.
                        </p>

                        {file ? (
                            <div className="mt-4 rounded-xl border border-[color:var(--surface-stroke)] bg-[var(--surface-strong)] p-3 text-sm">
                                <p className="font-semibold text-[var(--ink-900)]">{file.name}</p>
                                <p className="mt-1 text-[var(--ink-600)]">{formatBytes(file.size)}</p>
                            </div>
                        ) : (
                            <p className="mt-4 text-sm text-[var(--ink-500)]">No file selected yet.</p>
                        )}
                    </div>

                    <div className="flex flex-wrap gap-3">
                        <button type="submit" disabled={isUploading} className="btn-primary min-w-40 disabled:cursor-not-allowed disabled:opacity-70">
                            {isUploading ? 'Processing...' : dryRun ? 'Run Dry Preview' : 'Upload & Insert'}
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setFile(null);
                                setMessage('');
                                setError('');
                                setResponseData(null);
                            }}
                            className="btn-muted"
                        >
                            Clear
                        </button>
                    </div>
                </form>

                <div className="mt-5 rounded-xl border border-[color:var(--surface-stroke)] bg-[var(--surface-strong)] p-4">
                    <p className="text-sm font-semibold text-[var(--danger-600)]">Danger Zone</p>
                    <p className="mt-1 text-xs text-[var(--ink-600)]">
                        Permanently deletes all timetable-related database records.
                    </p>
                    <button
                        type="button"
                        onClick={handleDeleteDatabase}
                        disabled={isDeletingData || isUploading}
                        className="btn-danger mt-3 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                        {isDeletingData ? 'Deleting Data...' : 'Delete Database Data'}
                    </button>
                </div>

                {message && (
                    <div className="alert-success mt-5 rounded-xl px-4 py-3 text-sm">
                        {message}
                    </div>
                )}

                {error && (
                    <div className="alert-danger mt-5 rounded-xl px-4 py-3 text-sm">
                        {error}
                    </div>
                )}

                {deleteSummary && (
                    <div className="mt-4 rounded-xl border border-[color:var(--surface-stroke)] bg-[var(--surface-strong)] p-3">
                        <p className="text-sm font-semibold text-[var(--ink-700)]">Deleted Rows</p>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                            {Object.entries(deleteSummary).map(([table, count]) => (
                                <div key={table} className="rounded-lg border border-[color:var(--surface-stroke)] px-2 py-1.5">
                                    <p className="text-[var(--ink-600)]">{table}</p>
                                    <p className="font-semibold text-[var(--ink-900)]">{count}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </section>

            <aside className="glass-panel p-6">
                <h3 className="text-xl">Import Insights</h3>
                <p className="section-subtitle mt-2">Live summary updates after each upload operation.</p>

                {isUploading ? (
                    <div className="mt-5 space-y-3">
                        <div className="h-16 animate-pulse rounded-xl bg-[var(--surface)]" />
                        <div className="h-16 animate-pulse rounded-xl bg-[var(--surface)]" />
                        <div className="h-32 animate-pulse rounded-xl bg-[var(--surface)]" />
                    </div>
                ) : responseData ? (
                    <div className="mt-5 space-y-4">
                        {summaryCards.length > 0 && (
                            <div className="grid grid-cols-2 gap-3">
                                {summaryCards.map((item) => (
                                    <div key={item.label} className="rounded-xl border border-[color:var(--surface-stroke)] bg-[var(--surface-strong)] p-3">
                                        <p className="text-xs font-semibold uppercase tracking-[0.13em] text-[var(--ink-500)]">{item.label}</p>
                                        <p className="mt-1 text-2xl font-bold">{item.value}</p>
                                    </div>
                                ))}
                            </div>
                        )}

                        {sampleRows.length > 0 && (
                            <div className="rounded-xl border border-[color:var(--surface-stroke)] bg-[var(--surface-strong)] p-3">
                                <p className="text-sm font-semibold text-[var(--ink-700)]">Sample Parsed Rows</p>
                                <div className="soft-scroll mt-2 max-h-56 overflow-auto text-xs">
                                    <pre>{JSON.stringify(sampleRows, null, 2)}</pre>
                                </div>
                            </div>
                        )}

                        {errorRows.length > 0 && (
                            <div className="alert-warning rounded-xl p-3">
                                <p className="text-sm font-semibold">Warnings</p>
                                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                                    {errorRows.map((item) => (
                                        <li key={item}>{item}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="mt-5 rounded-xl border border-[color:var(--surface-stroke)] bg-[var(--surface-strong)] p-4 text-sm text-[var(--ink-600)]">
                        Upload a file to see parsed counts, duplicate detection, and failure details.
                    </div>
                )}
            </aside>
        </div>
    );
};

export default Upload;
