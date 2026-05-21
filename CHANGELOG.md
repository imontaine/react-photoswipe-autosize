# Changelog

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
