# Local dashboard assets

`npm run build` bundles browser code and copies these assets into `dist/public`, using `scripts/build-assets.ts`. Runtime pages load only local assets. The manifest is served at `/manifest.webmanifest`; icons, styles, logo, fonts and font licenses are served under `/assets/`.

The original logo is `docs/spec/logo.png`, supplied by Will. The build copies it unchanged as `/assets/logo.png`. The three committed PNG icons are generated from that same logo, preserving the complete mark on a white plate against the dashboard's dark purple. Regenerate them from the repository root with ImageMagick 7 installed:

```sh
npm run icons:generate
```

`scripts/generate-icons.sh` defines the composition and sizes: 512 and 192 pixels for the manifest, and 180 pixels for the iPhone home-screen icon. ImageMagick is needed only when regenerating these committed files, not for installing, building or running the service. Do not hand-edit generated PNGs.

The mockup's fonts are self-hosted, normal-style Latin variable WOFF2 files from pinned npm packages:

- `@fontsource-variable/outfit@5.3.0`: Outfit weights 100–900; copyright 2021 The Outfit Project Authors; upstream <https://github.com/Outfitio/Outfit-Fonts>.
- `@fontsource-variable/plus-jakarta-sans@5.3.0`: Plus Jakarta Sans weights 200–800; copyright 2020 The Plus Jakarta Sans Project Authors; upstream <https://github.com/tokotype/PlusJakartaSans>.

Both use the SIL Open Font License 1.1. Their original license files are copied alongside the fonts on every build. `fonts.css` uses the mockup's original family names and contains no remote font requests. The build copies unmodified font binaries from the lockfile-pinned packages; it does not generate or subset font files.

The manifest supports standalone home-screen installation. There is no service worker or offline cache for authenticated pages or data.
