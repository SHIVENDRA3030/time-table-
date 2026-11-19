import { useCallback, useRef, useState } from 'react';

// Shared toast notifications. `useToasts` returns { toasts, addToast }; render
// the messages with <ToastContainer toasts={toasts} /> once per page.
export const useToasts = () => {
    const [toasts, setToasts] = useState([]);
    const idRef = useRef(0);

    const addToast = useCallback((message, type = 'success') => {
        const id = ++idRef.current;
        setToasts((prev) => [...prev, { id, message, type }]);
        setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
    }, []);

    return { toasts, addToast };
};

export const ToastContainer = ({ toasts }) => (
    <div className="toast-container">
        {toasts.map((toast) => (
            <div key={toast.id} className={`toast ${toast.type === 'error' ? 'is-error' : toast.type === 'success' ? 'is-success' : ''}`}>
                {toast.message}
            </div>
        ))}
    </div>
);
