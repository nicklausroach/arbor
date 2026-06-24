import { useEffect, useState } from 'react';
import { api, type Project, type Repository } from './api';
import { ConnectView } from './ConnectView';
import { NewProjectView } from './NewProjectView';
import { PlanView } from './PlanView';
import { RunView } from './RunView';
import { Sidebar } from './Sidebar';
import { SettingsModal } from './SettingsModal';

type Screen = 'connect' | 'newProject' | 'project';

function App() {
  const [loading, setLoading] = useState(true);
  const [repos, setRepos] = useState<Repository[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentRepoId, setCurrentRepoId] = useState<string | null>(null);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>('connect');
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const [loadedRepos, loadedProjects] = await Promise.all([api.listRepos(), api.listProjects()]);
      setRepos(loadedRepos);
      setProjects(loadedProjects);
      const repo = loadedRepos[0] ?? null;
      if (!repo) {
        setScreen('connect');
      } else {
        setCurrentRepoId(repo.id);
        const project = loadedProjects.find((p) => p.repository_id === repo.id) ?? null;
        if (project) {
          setCurrentProjectId(project.id);
          setScreen('project');
        } else {
          setScreen('newProject');
        }
      }
      setLoading(false);
    })();
  }, []);

  function selectRepo(repoId: string) {
    setCurrentRepoId(repoId);
    const project = projects.find((p) => p.repository_id === repoId) ?? null;
    if (project) {
      setCurrentProjectId(project.id);
      setScreen('project');
    } else {
      setCurrentProjectId(null);
      setScreen('newProject');
    }
  }

  function handleConnected(repo: Repository) {
    setRepos((prev) => [...prev.filter((r) => r.id !== repo.id), repo]);
    setCurrentRepoId(repo.id);
    setCurrentProjectId(null);
    setScreen('newProject');
  }

  function handleProjectCreated(project: Project) {
    setProjects((prev) => [...prev, project]);
    setCurrentProjectId(project.id);
    setScreen('project');
  }

  function handleApproved(updated: Project) {
    setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  }

  async function handleDeleteProject(projectId: string) {
    if (!confirm('Delete this project? This cannot be undone.')) return;
    try {
      await api.deleteProject(projectId);
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
      if (currentProjectId === projectId) {
        setCurrentProjectId(null);
        const remainingProject = projects.find((p) => p.repository_id === currentRepoId && p.id !== projectId) ?? null;
        if (remainingProject) {
          setCurrentProjectId(remainingProject.id);
        } else {
          setScreen('newProject');
        }
      }
    } catch (err) {
      alert(`Failed to delete project: ${(err as Error).message}`);
    }
  }

  async function handleDeleteRepo(repoId: string) {
    const repo = repos.find((r) => r.id === repoId);
    const repoLabel = repo ? `${repo.owner}/${repo.name}` : 'this repo';
    if (!confirm(`Delete ${repoLabel} from Arbor? All of its projects will also be deleted. This cannot be undone.`)) return;
    try {
      await api.deleteRepo(repoId);
      const remainingRepos = repos.filter((r) => r.id !== repoId);
      const remainingProjects = projects.filter((p) => p.repository_id !== repoId);
      setRepos(remainingRepos);
      setProjects(remainingProjects);

      if (currentRepoId !== repoId) return;
      const nextRepo = remainingRepos[0] ?? null;
      if (!nextRepo) {
        setCurrentRepoId(null);
        setCurrentProjectId(null);
        setScreen('connect');
        return;
      }

      setCurrentRepoId(nextRepo.id);
      const nextProject = remainingProjects.find((p) => p.repository_id === nextRepo.id) ?? null;
      if (nextProject) {
        setCurrentProjectId(nextProject.id);
        setScreen('project');
      } else {
        setCurrentProjectId(null);
        setScreen('newProject');
      }
    } catch (err) {
      alert(`Failed to delete repo: ${(err as Error).message}`);
    }
  }


  const currentProject = projects.find((p) => p.id === currentProjectId) ?? null;
  const projectsForRepo = projects.filter((p) => p.repository_id === currentRepoId);

  return (
    <div style={{ height: '100vh', display: 'flex', overflow: 'hidden' }}>
      {!loading && repos.length > 0 && (
        <Sidebar
          repos={repos}
          currentRepoId={currentRepoId}
          projects={projectsForRepo}
          currentProjectId={screen === 'project' ? currentProjectId : null}
          onSelectRepo={selectRepo}
          onConnectAnother={() => setScreen('connect')}
          onSelectProject={(id) => {
            setCurrentProjectId(id);
            setScreen('project');
          }}
          onNewProject={() => setScreen('newProject')}
          onDeleteProject={handleDeleteProject}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}
      <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading…</div>
        ) : screen === 'connect' ? (
          <ConnectView onConnected={handleConnected} />
        ) : screen === 'newProject' && currentRepoId ? (
          <NewProjectView repositoryId={currentRepoId} onCreated={handleProjectCreated} />
        ) : currentProject ? (
          currentProject.status === 'draft' || currentProject.status === 'approval_failed' ? (
            <PlanView projectId={currentProject.id} onApproved={(result) => handleApproved(result.project)} />
          ) : (
            <RunView projectId={currentProject.id} />
          )
        ) : null}
      </div>
      {settingsOpen && <SettingsModal repos={repos} currentRepoId={currentRepoId} onDeleteRepo={handleDeleteRepo} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

export default App;
