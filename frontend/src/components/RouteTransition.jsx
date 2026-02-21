import React from 'react';
import { useLocation, useOutlet } from 'react-router-dom';

const RouteTransition = () => {
    const location = useLocation();
    const outlet = useOutlet();
    const routeKey = location.pathname + location.search;

    return (
        <div className="route-stage">
            <div key={routeKey} className="route-node">
                {outlet}
            </div>
        </div>
    );
};

export default RouteTransition;
