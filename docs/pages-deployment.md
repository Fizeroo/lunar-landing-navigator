# GitHub Pages deployment

The existing repository and `main` branch are prepared to publish the existing static application at:

**https://fizeroo.github.io/lunar-landing-navigator/**

Repository visibility was already public and was not changed. GitHub Pages is configured with `build_type: workflow`. The workflow is `.github/workflows/pages.yml`; deployment history is available in the repository Actions tab.

The build job installs the lockfile with `npm ci`, selects Node.js 24, sets `VITE_BASE_PATH=/lunar-landing-navigator/`, and runs `npm run build`. Only `dist` is uploaded as the Pages artifact. The deploy job uses the `github-pages` environment with `pages: write` and `id-token: write`. Actions are pinned to verified official commit SHAs. No personal token is stored in the workflow or project; the standard workflow `GITHUB_TOKEN` and OIDC handle deployment.

Vite defaults to `/` for ordinary local runs. All runtime JSON and global-height binary fetches resolve through `import.meta.env.BASE_URL`, as do Moon, Earth and star-map textures. Fragment scenario links preserve the current path. There is no client-side path router, so refreshing the site root or a scenario fragment does not require a rewrite or custom 404 page.

The subpath build was checked for generated script/style prefixes and packaged data/texture files. Publication acceptance is deliberately small: HTTPS page and 3D load, real data and imagery load, candidate search, Surface entry, and page refresh. The 107 numerical tests and long browser suite are not repeated for a deployment/path-only change. Application features, models and prepared data are unchanged.

Reference: [Vite GitHub Pages deployment](https://vite.dev/guide/static-deploy.html#github-pages) and [GitHub custom Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

No custom domain, paid service or competition entry is created.

## Pending authorization step

Pages itself is enabled and the repository remains public. The current Git credential lacks the `workflow` scope, so GitHub rejects creating `.github/workflows/pages.yml`. The connected GitHub integration independently returns HTTP 403 for the same workflow write. No token, account scope or repository visibility was changed.

The subpath/resource configuration and documentation are pushed separately. The workflow is preserved in a local commit. In the existing repository, use **Add file -> Create new file**, name it **`.github/workflows/pages.yml`**, paste the prepared local file, and commit it to **main**. This one web-UI action triggers the configured build/deploy automatically. No secret needs to be supplied or added to the workflow. A successful deployment and public browser verification are still pending; a successful source push alone is not publication.
