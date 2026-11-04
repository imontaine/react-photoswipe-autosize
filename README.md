# react-photoswipe-autosize

Drop-in auto-sizing for [react-photoswipe-gallery](https://github.com/dromru/react-photoswipe-gallery) — **no `width`/`height` props needed**.

Image dimensions are detected automatically at runtime using background preloading, with a material-style loading spinner shown during detection.

## Features

- **Zero-config dimensions** — just provide `original` and `thumbnail`, no width/height
- **Instant cached opens** — dimensions are cached across gallery opens; second click is instant
- **Hover pre-caching** — optional `usePreloadOnHover()` pre-fetches dimensions on mouse enter
- **Loading spinner** — Material arc spinner while dimensions are detected
- **No blur flash** — disables PhotoSwipe's default blurry thumbnail-to-image transition
- **Race-safe** — handles rapid navigation, in-flight deduplication, and stale slide recycling

## Install

```bash
npm install react-photoswipe-autosize photoswipe react-photoswipe-gallery
```

## Usage

```tsx
import { AutoSizeGallery, AutoSizeItem, usePreloadOnHover } from 'react-photoswipe-autosize'
import 'react-photoswipe-autosize/styles.css'
import 'photoswipe/dist/photoswipe.css'

function MyGallery() {
  const preload = usePreloadOnHover()
  const fullSizeUrl = 'https://example.com/big.jpg'
  const thumbUrl = 'https://example.com/thumb.jpg'

  return (
    <AutoSizeGallery>
      <AutoSizeItem original={fullSizeUrl} thumbnail={thumbUrl}>
        {({ ref, open }) => (
          <img
            ref={ref}
            onClick={open}
            onMouseEnter={() => preload(fullSizeUrl)}
            src={thumbUrl}
            alt="My photo"
          />
        )}
      </AutoSizeItem>
    </AutoSizeGallery>
  )
}
```

## API

### `<AutoSizeGallery>`

Drop-in replacement for `<Gallery>`. Accepts all the same props plus auto-size behavior.

| Prop | Type | Description |
|------|------|-------------|
| `options` | `PhotoSwipeOptions` | PhotoSwipe options (auto-size defaults are applied first, your overrides win) |
| `onBeforeOpen` | `(pswp) => void` | Called after auto-size hooks are registered |

Default options applied:
- `showHideAnimationType: 'none'`
- `bgOpacity: 1`
- Animation durations: `0`

### `<AutoSizeItem>`

Drop-in replacement for `<Item>`. Same props but `width`/`height` are **optional** (defaults to auto-detection).

| Prop | Type | Description |
|------|------|-------------|
| `original` | `string` | Full-size image URL |
| `thumbnail` | `string` | Thumbnail URL |
| `width` | `number \| string` | Optional override (bypasses auto-detection) |
| `height` | `number \| string` | Optional override (bypasses auto-detection) |

### `usePreloadOnHover()`

Returns a `(src: string) => void` callback for pre-caching dimensions on hover.

```tsx
const preload = usePreloadOnHover()
<img onMouseEnter={() => preload(fullSizeUrl)} />
```

## Theming

The spinner color automatically matches PhotoSwipe's `--pswp-icon-color` variable. Override it:

```css
/* Custom spinner color */
.pswp {
  --pswp-spinner-color: #ff0000;
}

/* Light theme example */
.pswp {
  --pswp-bg: #fff;
  --pswp-icon-color: #000;
  --pswp-icon-color-secondary: #bbb;
  --pswp-icon-stroke-color: #bbb;
}
.pswp__counter { color: #000; text-shadow: none; }
.pswp__top-bar { background: none; }
```

## How it works

1. `<AutoSizeItem>` renders with `1×1` placeholder dimensions
2. On lightbox open, an `itemData` filter injects any cached dimensions before slide creation
3. For uncached images, `contentLoad` fires a background `new Image()` preload
4. `contentAppend` hides the placeholder element and shows a spinner
5. Once dimensions resolve, `refreshSlideContent` recreates the slide at full size
6. A deduplication layer (`startPreload`) prevents duplicate loads from hover + click

## Publishing releases

GitHub Actions builds and checks the package on pull requests and pushes to
`main`. Publishing a stable GitHub Release then publishes the matching version
to npm using trusted publishing. Prereleases are not published to npm.

### One-time npm setup

In the npm package's **Settings → Trusted Publisher**, choose **GitHub Actions**
and configure:

- Organization or user: `jomashopio`
- Repository: `react-photoswipe-autosize`
- Workflow filename: `publish.yml`
- Environment name: leave blank
- Allow direct publishing with `npm publish`

The workflow lives at `.github/workflows/publish.yml`. It uses Node.js 24 and npm
OIDC authentication, so no npm token needs to be stored in GitHub secrets.

### Release a new version

1. Update the version with `npm version patch --no-git-tag-version` (or `minor`
   or `major`). This updates both `package.json` and `package-lock.json`.
2. Update `CHANGELOG.md` and merge the changes into `main`.
3. Create and publish a stable GitHub Release targeting that commit on `main`,
   using a tag that exactly matches the package version, such as `v1.0.8`.
4. Check the **Build and publish** workflow in GitHub Actions. It validates the
   version and source, builds the package, and publishes it to npm with provenance.

The existing `1.0.7` version can be released as `v1.0.7` after the one-time setup.
If publishing fails, fix the reported problem and rerun the failed workflow job.
Versions that have already been published to npm cannot be published again.

## License

MIT
