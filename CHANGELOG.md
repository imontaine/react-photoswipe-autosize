# Changelog

## 1.0.7

### Fixed

- Mobile popup images opening at `1px × 1px`: `AutoSizeItem` no longer falls back to `1` when `width`/`height` are omitted, so slides are sized from the detected dimensions instead
- Slides whose content was sized before their dimensions resolved — including lazily preloaded neighbours — are now refreshed once the real dimensions are known, so PhotoSwipe marks them zoomable after swiping to them
- Cached dimensions are compared against the current content size, so slides that are already sized correctly are not refreshed again
- Explicit `width`/`height` (or already-resolved) dimensions are no longer overwritten by cached values, and the `itemData` filter returns a copy instead of mutating PhotoSwipe's item data
- Removed the mount-time `useEffect` preload from `AutoSizeItem` — it downloaded every full-size image as soon as gallery items mounted. Detection and resizing stay at the lightbox open boundary (`contentLoad` → `refreshSlideContent`), with results cached for subsequent opens
- The `800×600` fallback for images that fail to load is now cached as well, preventing endless refresh retries for a broken image

## 1.0.6

### Fixed

- Mobile: popup images no longer open at `1px × 1px`. `AutoSizeItem` now resolves the real image dimensions when `width`/`height` are omitted and re-registers the item once detected, instead of keeping the `1×1` sentinel

## 1.0.5

### Fixed

- Fix async race condition in `contentLoad` handler that caused Safari to throw during `img.decode()` when the gallery was closed or a different slide was navigated to before the image preload finished
- Capture `content.slide` before the async gap and verify `pswp.currSlide === slide` after preload resolves
- Validate `itemData` src still matches to prevent refreshing the wrong slide with duplicate image URLs

## 1.0.4

### Fixed

- Fix issue image not load when click multiple thumbs

## 1.0.3

### Fixed

- Update loading AutoSizeGallery content image for AutoSizeItem
- Example: `content={ <div><img className="pswp__img" src={src} alt={alt} /></div>}`

## 1.0.2

### Fixed

- README usage example now uses named variables (`fullSizeUrl`, `thumbUrl`) to clarify that `preload()` should target the full-size image URL, not the thumbnail
- Demo app renamed image property from `src` to `full` to avoid confusion with the `<img>` element's `src` attribute

## 1.0.1

### Fixed

- Spinner is now appended to `holderElement` instead of the content container, preventing it from shifting during zoom
- Added `contentRemove` cleanup to properly dispose spinner elements when slides are removed

## 1.0.0

### Added

- `AutoSizeGallery` — drop-in replacement for `<Gallery>` with automatic dimension detection
- `AutoSizeItem` — drop-in replacement for `<Item>` that doesn't require `width`/`height` props
- `usePreloadOnHover()` — hook for pre-caching image dimensions on mouse enter
- Material-style arc spinner shown while dimensions are being detected
- In-flight deduplication to prevent redundant loads from hover + click
- Dimension caching for instant subsequent opens
