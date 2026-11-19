import React from 'react';
import { useNavigate } from 'react-router-dom';
import authClient from '../services/auth';
import { useMe } from '../context/MeContext';

// Shown instead of the app shell when the signed-in account is not on the
// portal-access allowlist (me.provisioned === false).
const NotProvisioned = () => {
    const navigate = useNavigate();
    const { me } = useMe();

    const signOut = async () => {
        await authClient.signOut();
        navigate('/login', { replace: true });
    };

    return (
        <section className="card mx-auto mt-10 max-w-xl p-10 text-center">
            <p className="chip chip-warn mx-auto">Access pending</p>
            <h2 className="mt-3 text-[24px] leading-[30px]">You are not added to any college or faculty yet</h2>
            <p className="mt-3 text-sm text-[var(--text-2)]">
                {me?.user?.email ? (
                    <>
                        Your account (<strong className="break-all">{me.user.email}</strong>) is signed in, but it
                        hasn&apos;t been added to this portal&apos;s allowlist.
                    </>
                ) : (
                    'This account hasn\'t been added to this portal\'s allowlist.'
                )}{' '}
                Please contact your timetable administrator — once they add your email, sign in again and your
                timetable will appear here.
            </p>
            <button type="button" onClick={signOut} className="btn-primary mt-6 inline-flex">
                Sign out
            </button>
        </section>
    );
};

export default NotProvisioned;
