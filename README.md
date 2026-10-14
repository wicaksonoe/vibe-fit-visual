# Stride Atlas

A private, browser-based FIT activity dashboard with an open map, interactive 3D route/elevation rendering, metric charts, and a complete data explorer.

## Run locally

```bash
yarn install
yarn dev
```

Open the URL printed by Vite, then drop or browse for a `.fit` file.

## Production build

```bash
yarn build
yarn preview
```

The static site is generated in `dist/` and can be hosted on any static host.

## Deploy to GitHub Pages

The repository includes `.github/workflows/deploy-pages.yml`. After connecting and pushing the `main` branch to GitHub:

1. Open the repository's **Settings → Pages**.
2. Set **Source** to **GitHub Actions**.
3. Push to `main`, or run **Deploy to GitHub Pages** from the Actions tab.

Vite automatically uses `/<repository-name>/` as its base path during the Actions build, so project Pages URLs work without manual configuration.

## Stack and privacy

- React + Vite
- `fit-file-parser` (all parsing happens locally in the browser)
- MapLibre GL + OpenStreetMap raster tiles
- Mapzen/AWS Terrarium elevation tiles
- deck.gl for the elevated 3D route
- Recharts for activity metrics

No activity file is uploaded or stored. FIT files are ignored by Git and no sample activity is included in the public site. Map and terrain tiles are fetched from their public providers. If a FIT file has no usable elevation samples, the route is rendered flat.
