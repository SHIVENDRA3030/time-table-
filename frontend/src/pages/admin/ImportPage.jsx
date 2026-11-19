import React, { useMemo, useState } from 'react';
import api from '../../services/api';
import ConfirmDialog from '../../components/ConfirmDialog';

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

const ImportPage = () => {
    const [file, setFile] = useState(null);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [responseData, setResponseData] = useState(null);
    const [previewData, setPreviewData] = useState(null);
    const [jobId, setJobId] = useState(null);
    const [isUploading, setIsUploading] = useState(false);
    const [isCommitting, setIsCommitting] = useState(false);
    const [isDeletingData, setIsDeletingData] = useState(false);
    const [dragActive, setDragActive] = useState(false);
    const [deleteSummary, setDeleteSummary] = useState(null);
    const [confirmDelete, setConfirmDelete] = useState(false);

    const handleFileSelection = (selectedFile) => {
        if (!selectedFile) return;
        setFile(selectedFile);
        setMessage('');
        setError('');
        setResponseData(null);
        setPreviewData(null);
        setJobId(null);
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

    // Staged import (F4): the upload only parses + validates (202 + job id);
    // a separate commit applies everything in one server-side transaction.
    const handleUpload = async (e) => {
        e.preventDefault();

        if (!file) {
            setError('Choose an Excel file first.');
            return;
        }

        const formData = new FormData();
        formData.append('file', file);

        setIsUploading(true);
        setError('');
        setMessage('');

        try {
            const response = await api.post('/upload', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });

            const payload = response.data || {};
            setJobId(payload.jobId || null);
            setPreviewData(payload.preview || null);
            setResponseData(null);
            setDeleteSummary(null);
            setMessage(payload.message || 'File staged — review the preview, then commit.');

            if (payload.preview?.quality && typeof window !== 'undefined') {
                const snapshot = {
                    ...payload.preview.quality,
                    updatedAt: new Date().toISOString(),
                    source: 'staged',
                };
                window.localStorage.setItem(DASHBOARD_QUALITY_KEY, JSON.stringify(snapshot));
            }
        } catch (err) {
            setError('Failed to upload file. ' + (err.response?.data?.error || err.message));
            setResponseData(null);
            setPreviewData(null);
            setJobId(null);
        } finally {
            setIsUploading(false);
        }
    };

    const handleCommit = async () => {
        if (!jobId) return;
        setIsCommitting(true);
        setError('');
        setMessage('Committing import…');

        try {
            await api.post(`/imports/${jobId}/commit`);

            // Poll the job until the worker finishes (or fails).
            let finalJob = null;
            for (let i = 0; i < 60; i++) {
                await new Promise((resolve) => setTimeout(resolve, 1500));
                const jobRes = await api.get(`/jobs/${jobId}`);
                finalJob = jobRes.data;
                if (finalJob.status === 'done' || finalJob.status === 'failed') break;
            }

            if (finalJob?.status === 'done') {
                const results = finalJob.result || {};
                setResponseData({ results });
                setPreviewData(null);
                setJobId(null);
                setMessage(`Import committed — ${results.inserted ?? 0} inserted, ${results.failed ?? 0} failed.`);
                if (typeof window !== 'undefined') {
                    window.localStorage.removeItem(DASHBOARD_QUALITY_KEY);
                }
            } else {
                setError('Import failed. ' + (finalJob?.error || 'Check the staged preview and try again.'));
            }
        } catch (err) {
            setError('Failed to commit import. ' + (err.response?.data?.error || err.message));
        } finally {
            setIsCommitting(false);
        }
    };

    const handleDeleteDatabase = async () => {
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

        if (previewData) {
            return [
                { label: 'Parsed', value: previewData.totalParsed ?? 0 },
                { label: 'Missing rooms', value: previewData.quality?.missingRooms ?? 0 },
                { label: 'Online classes', value: previewData.quality?.onlineClasses ?? 0 },
            ];
        }

        return [];
    }, [responseData, previewData]);

    const sampleRows = Array.isArray(previewData?.sample) ? previewData.sample.slice(0, 6) : [];
    const errorRows = Array.isArray(responseData?.results?.errors) ? responseData.results.errors.slice(0, 8) : [];

    return (
        <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
            <section className="card p-6 md:p-7">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h2 className="text-[20px] leading-7">Upload timetable Excel</h2>
                        <p className="section-subtitle">
                            Stage the file, review the parsed preview, then commit. The insert runs in one
                            transaction in the background.
                        </p>
                    </div>
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
                        className={`rounded-lg border border-dashed p-6 transition ${dragActive
                            ? 'tt-drop border-[var(--text-1)]'
                            : 'border-[var(--line)] bg-[var(--surface)]'}`}
                    >
                        <label className="block cursor-pointer text-sm font-medium text-[var(--text-1)]">
                            Select or drop `.xlsx` / `.xls`
                            <input
                                type="file"
                                accept=".xlsx,.xls"
                                onChange={handleFileChange}
                                className="sr-only"
                            />
                        </label>
                        <p className="mt-2 text-sm text-[var(--text-2)]">
                            The parser recognizes timetable grids with `Day/Time` and `Code` mapping sections.
                        </p>

                        {file ? (
                            <div className="mt-4 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-3 text-sm">
                                <p className="font-medium text-[var(--text-1)]">{file.name}</p>
                                <p className="mono mt-1 text-[var(--text-2)]">{formatBytes(file.size)}</p>
                            </div>
                        ) : (
                            <p className="mt-4 text-sm text-[var(--text-3)]">No file selected yet.</p>
                        )}
                    </div>

                    <div className="flex flex-wrap gap-3">
                        <button type="submit" disabled={isUploading || isCommitting} className="btn-primary min-w-40">
                            {isUploading ? 'Parsing…' : 'Stage & preview'}
                        </button>
                        {jobId && previewData && (
                            <button
                                type="button"
                                onClick={handleCommit}
                                disabled={isCommitting}
                                className="btn-primary min-w-40"
                            >
                                {isCommitting ? 'Committing…' : 'Commit import'}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => {
                                setFile(null);
                                setMessage('');
                                setError('');
                                setResponseData(null);
                                setPreviewData(null);
                                setJobId(null);
                            }}
                            className="btn-secondary"
                        >
                            Clear
                        </button>
                    </div>
                </form>

                <div className="mt-5 rounded-lg border border-[var(--line)] p-4">
                    <p className="text-sm font-medium text-[var(--danger)]">Danger zone</p>
                    <p className="mt-1 text-xs text-[var(--text-2)]">
                        Permanently deletes all timetable-related database records.
                    </p>
                    <button
                        type="button"
                        onClick={() => setConfirmDelete(true)}
                        disabled={isDeletingData || isUploading}
                        className="btn-danger mt-3"
                    >
                        {isDeletingData ? 'Deleting data…' : 'Delete database data'}
                    </button>
                </div>

                {message && (
                    <div className="alert-success mt-5">
                        {message}
                    </div>
                )}

                {error && (
                    <div className="alert-danger mt-5">
                        {error}
                    </div>
                )}

                {deleteSummary && (
                    <div className="mt-4 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3">
                        <p className="text-sm font-medium text-[var(--text-1)]">Deleted rows</p>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                            {Object.entries(deleteSummary).map(([table, count]) => (
                                <div key={table} className="rounded-lg border border-[var(--line)] px-2 py-1.5">
                                    <p className="text-[var(--text-2)]">{table}</p>
                                    <p className="mono font-medium text-[var(--text-1)]">{count}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </section>

            <aside className="card p-6">
                <h3 className="text-[20px] leading-7">Import insights</h3>
                <p className="section-subtitle">Live summary updates after each upload operation.</p>

                {isUploading || isCommitting ? (
                    <div className="mt-5 space-y-3">
                        <div className="h-16 animate-pulse rounded-lg bg-[var(--surface-2)]" />
                        <div className="h-16 animate-pulse rounded-lg bg-[var(--surface-2)]" />
                        <div className="h-32 animate-pulse rounded-lg bg-[var(--surface-2)]" />
                    </div>
                ) : previewData || responseData ? (
                    <div className="mt-5 space-y-4">
                        {summaryCards.length > 0 && (
                            <div className="grid grid-cols-2 gap-3">
                                {summaryCards.map((item) => (
                                    <div key={item.label} className="rounded-lg border border-[var(--line)] p-3">
                                        <p className="caption uppercase tracking-[0.05em]">{item.label}</p>
                                        <p className="mono mt-1 text-[22px] leading-7 font-medium text-[var(--text-1)]">{item.value}</p>
                                    </div>
                                ))}
                            </div>
                        )}

                        {sampleRows.length > 0 && (
                            <div className="rounded-lg border border-[var(--line)] p-3">
                                <p className="text-sm font-medium text-[var(--text-1)]">Sample parsed rows</p>
                                <div className="soft-scroll mt-2 max-h-56 overflow-auto text-xs">
                                    <pre className="font-code">{JSON.stringify(sampleRows, null, 2)}</pre>
                                </div>
                            </div>
                        )}

                        {errorRows.length > 0 && (
                            <div className="alert-warning">
                                <p className="text-sm font-medium">Warnings</p>
                                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                                    {errorRows.map((item) => (
                                        <li key={item}>{item}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="empty-state !p-8">
                        <span className="empty-state-glyph">⌖</span>
                        <p className="text-sm">Upload a file to see parsed counts, duplicates, and failures.</p>
                    </div>
                )}
            </aside>

            <ConfirmDialog
                isOpen={confirmDelete}
                title="Delete database data"
                message="This permanently removes programs, sections, subjects, faculty, rooms, slots, and timetable entries."
                confirmLabel="Delete all data"
                danger
                requireText="DELETE"
                onConfirm={handleDeleteDatabase}
                onClose={() => setConfirmDelete(false)}
            />
        </div>
    );
};

export default ImportPage;
