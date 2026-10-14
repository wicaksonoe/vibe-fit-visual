import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => {
  const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1];
  const isGitHubPagesBuild = process.env.GITHUB_ACTIONS === 'true' && repositoryName;

  return {
    // Project Pages sites are hosted under /<repository>/ rather than /. The
    // Actions environment supplies the repository name automatically.
    base: isGitHubPagesBuild ? `/${repositoryName}/` : '/',
    plugins: [react()],
  };
});
