import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { SignedIn, SignedOut, RedirectToSignIn } from '@clerk/clerk-react';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Upload from './pages/Upload';
import Timetables from './pages/Timetables';
import Login from './pages/Login';
import AxiosInterceptor from './components/AxiosInterceptor';

function App() {
  return (
    <BrowserRouter>
      <AxiosInterceptor>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={
            <>
              <SignedIn>
                <Layout />
              </SignedIn>
              <SignedOut>
                <RedirectToSignIn />
              </SignedOut>
            </>
          }>
            <Route index element={<Dashboard />} />
            <Route path="upload" element={<Upload />} />
            <Route path="timetables" element={<Timetables />} />
          </Route>
        </Routes>
      </AxiosInterceptor>
    </BrowserRouter>
  );
}

export default App;
