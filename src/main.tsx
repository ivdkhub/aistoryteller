import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import './styles.css';
import { Layout } from './components/Layout.tsx';
import { Home } from './pages/Home.tsx';
import { AccountPage } from './pages/AccountPage.tsx';
import { ProjectPage } from './pages/ProjectPage.tsx';
import { CharacterPage } from './pages/CharacterPage.tsx';
import { EpisodePage } from './pages/EpisodePage.tsx';
import { CalendarPage } from './pages/CalendarPage.tsx';
import { IdeasPage } from './pages/IdeasPage.tsx';
import { SearchPage } from './pages/SearchPage.tsx';
import { ImportPage } from './pages/ImportPage.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="account/:id" element={<AccountPage />} />
          <Route path="progetto/:id" element={<ProjectPage />} />
          <Route path="progetto/:id/:tab" element={<ProjectPage />} />
          <Route path="personaggio/:id" element={<CharacterPage />} />
          <Route path="episodio/:id" element={<EpisodePage />} />
          <Route path="episodio/:id/:tab" element={<EpisodePage />} />
          <Route path="calendario" element={<CalendarPage />} />
          <Route path="idee" element={<IdeasPage />} />
          <Route path="cerca" element={<SearchPage />} />
          <Route path="import" element={<ImportPage />} />
          <Route path="*" element={<Home />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
