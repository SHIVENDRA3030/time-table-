import React from 'react';
import { Link } from 'react-router-dom';

const NotFound = () => (
    <section className="card p-10 text-center">
        <p className="caption">404</p>
        <h2 className="mt-3 text-3xl">This page doesn't exist</h2>
        <p className="mt-2 text-sm text-[var(--text-2)]">
            The link may be outdated or the address mistyped.
        </p>
        <Link to="/" className="btn-primary mt-6 inline-flex">Back to Dashboard</Link>
    </section>
);

export default NotFound;
