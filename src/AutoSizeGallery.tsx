/**
 * AutoSizeGallery — PhotoSwipe without image dimensions
 * ──────────────────────────────────────────────────────
 * Drop-in replacements for <Gallery> and <Item> from react-photoswipe-gallery
 * that automatically detect image dimensions at runtime.
 *
 * HOW IT WORKS:
 * 1. Each <AutoSizeItem> renders with a 1×1 placeholder (sentinel value)
 * 2. An `itemData` filter injects cached dimensions before slides are created
 * 3. For uncached images, `contentLoad` fires a background preload
 * 4. Once resolved, `refreshSlideContent` recreates the slide at full size
 *
 * Requires: photoswipe-spinner.css (or react-photoswipe-autosize/styles.css)
 */

import { useCallback } from 'react'
import { Gallery, Item } from 'react-photoswipe-gallery'
import type { GalleryProps, ItemProps } from 'react-photoswipe-gallery'

// ─── Spinner SVG markup (injected into slide containers) ────────────

const SPINNER_SVG = `<svg class="pswp-spinner" viewBox="0 0 50 50">
  <circle class="pswp-spinner__path" cx="25" cy="25" r="20"
          fill="none" stroke-width="5"></circle>
</svg>`

// ─── Dimension preloader ────────────────────────────────────────────

/** Module-level so it survives re-renders and persists across gallery opens */
const dimensionCache = new Map<string, { w: number; h: number }>()

function preloadImage(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const cached = dimensionCache.get(src)
    if (cached) {
      resolve(cached)
      return
    }

    const img = new Image()
    img.onload = () => {
      const dims = { w: img.naturalWidth, h: img.naturalHeight }
      dimensionCache.set(src, dims)
      resolve(dims)
    }
    img.onerror = () => {
      // Fallback: use a reasonable default so PhotoSwipe doesn't break
      const dims = { w: 800, h: 600 }
      resolve(dims)
    }
    img.src = src
  })
}

// ─── Hover pre-cache hook ───────────────────────────────────────────

/** In-flight preloads — prevents duplicate loads from hover + lightbox open */
const inFlightPreloads = new Map<string, Promise<{ w: number; h: number }>>()

function startPreload(src: string): Promise<{ w: number; h: number }> {
  const cached = dimensionCache.get(src)
  if (cached) return Promise.resolve(cached)

  // Return existing promise to avoid duplicate network requests
  const existing = inFlightPreloads.get(src)
  if (existing) return existing

  const promise = preloadImage(src).then((dims) => {
    inFlightPreloads.delete(src)
    return dims
  })
  inFlightPreloads.set(src, promise)
  return promise
}

/**
 * Returns a handler to pre-cache image dimensions on mouse enter.
 * By the time the user clicks, dimensions are often already known.
 */
export function usePreloadOnHover() {
  return useCallback((src: string) => {
    startPreload(src) // fire-and-forget
  }, [])
}

// ─── Helpers ────────────────────────────────────────────────────────

function resolveSrc(content: any): string | undefined {
  return content?.data?.src || content?.data?.original
}

function findImg(el: HTMLElement | undefined): HTMLImageElement | undefined {
  if (!el) return undefined
  if (el.tagName === 'IMG') return el as HTMLImageElement
  return el.querySelector('img') ?? undefined
}

// ─── Attach spinner + reveal logic to a holder ──────────────────────
// Called both from contentAppend (initial mount) and after
// refreshSlideContent recreates the slide element.
//
// Strategy:
//   1. Insert spinner into holder immediately.
//   2. Find the <img> — either already in content.element (standard slides)
//      or not yet mounted (custom content). Use MutationObserver for the
//      latter so we catch the img as soon as React appends it.
//   3. Once we have the img: hide it, attach load/error → reveal.
//   4. If img is already complete (cached), reveal immediately.
//
// Returns the MutationObserver (if one was created) so callers can store
// it for cleanup when the holder is recycled.

function attachSpinner(
  content: any,
  holder: HTMLElement,
  holderObservers: WeakMap<HTMLElement, MutationObserver>,
): void {
  // Clean up any previous observer on this holder before attaching a new one
  holderObservers.get(holder)?.disconnect()
  holderObservers.delete(holder)

  holder.querySelector('.pswp-spinner')?.remove()
  holder.insertAdjacentHTML('beforeend', SPINNER_SVG)

  const reveal = (imgEl: HTMLImageElement) => {
    imgEl.style.visibility = ''
    holder.querySelector('.pswp-spinner')?.remove()
  }

  const attachToImg = (imgEl: HTMLImageElement) => {
    // Already fully loaded — reveal right away
    if (imgEl.complete && imgEl.naturalWidth > 1) {
      reveal(imgEl)
      return
    }
    imgEl.style.visibility = 'hidden'
    imgEl.addEventListener('load',  () => reveal(imgEl), { once: true })
    imgEl.addEventListener('error', () => reveal(imgEl), { once: true })
  }

  // content.element may be the <img> itself (standard) or a <div> wrapper
  // (custom content). In either case try to find an img synchronously first.
  const imgNow = findImg(content.element)
  if (imgNow) {
    attachToImg(imgNow)
    return
  }

  // Custom content: React hasn't mounted the element into the holder yet.
  // Watch the holder subtree for the first <img> to appear.
  const observer = new MutationObserver(() => {
    const imgEl = holder.querySelector<HTMLImageElement>('img')
    if (!imgEl) return
    observer.disconnect()
    holderObservers.delete(holder)
    attachToImg(imgEl)
  })

  observer.observe(holder, { childList: true, subtree: true })
  holderObservers.set(holder, observer)

  // Safety valve: bail out after 1 s so we never leak an observer
  setTimeout(() => {
    if (holderObservers.get(holder) === observer) {
      observer.disconnect()
      holderObservers.delete(holder)
      holder.querySelector('.pswp-spinner')?.remove()
    }
  }, 1000)
}

// ─── AutoSizeGallery ────────────────────────────────────────────────

export type AutoSizeGalleryProps = Omit<GalleryProps, 'onBeforeOpen'> & {
  onBeforeOpen?: GalleryProps['onBeforeOpen']
}

export function AutoSizeGallery({
  children,
  options,
  onBeforeOpen: userOnBeforeOpen,
  ...rest
}: AutoSizeGalleryProps) {
  const handleBeforeOpen: GalleryProps['onBeforeOpen'] = (pswp) => {

    // Keyed by holderElement — survives slide recycling across the gallery session
    const holderObservers = new WeakMap<HTMLElement, MutationObserver>()

    // ── Inject cached dimensions before slide construction ──────────
    pswp.addFilter('itemData', (itemData: any) => {
      const src: string | undefined = itemData?.src ?? itemData?.original
      if (!src) return itemData

      const cached = dimensionCache.get(src)
      if (cached) {
        itemData.width  = cached.w
        itemData.height = cached.h
        itemData.w      = cached.w
        itemData.h      = cached.h
      }
      return itemData
    })

    // ── Disable blurry thumbnail placeholder ────────────────────────
    pswp.addFilter('useContentPlaceholder', () => false)

    // ── Start dimension preload for uncached slides ─────────────────
    pswp.on('contentLoad', ({ content }: any) => {
      const src = resolveSrc(content)
      if (!src || dimensionCache.has(src)) return

      // Capture the slide reference *before* the async gap so we can
      // verify it is still current after the preload resolves.
      const slide = content.slide

      startPreload(src)
        .then(() => {
          // Guard: the gallery may have closed, moved to another slide,
          // or the slide may have been recycled while we were loading.
          if (!slide || pswp.currSlide !== slide) return

          const slideIndex = slide.index
          const itemData = (pswp as any).getItemData?.(slideIndex)

          // Verify the data source still matches — avoids refreshing
          // the wrong slide when duplicate image URLs are present.
          if ((itemData?.src ?? itemData?.original) !== src) return

          try {
            // refreshSlideContent destroys and recreates content.element.
            // contentAppend fires again for the new element, which re-runs
            // attachSpinner — that's where the new load listener is wired up.
            pswp.refreshSlideContent(slideIndex)
          } catch (error) {
            console.error('Failed to refresh PhotoSwipe content', error)
          }
        })
        .catch(() => {
          // Preload failure — safe to ignore
        })
    })

    // ── Wire up spinner on initial slide mount ──────────────────────
    pswp.on('contentAppend', (e: any) => {
      const { content } = e
      const src = resolveSrc(content)
      if (!src) return

      const holder: HTMLElement | undefined = content.slide?.holderElement
      if (!holder) return

      attachSpinner(content, holder, holderObservers)
    })

    // ── Re-wire spinner after refreshSlideContent recreates element ─
    // PhotoSwipe fires `contentActivate` on the slide that just became
    // current, but more reliably we can use `slideActivate` which fires
    // whenever the active slide changes — including after a refresh.
    // The safest hook here is `contentAppendImage` (fires after PhotoSwipe
    // appends a refreshed element) but it's not always available; instead
    // we listen to `change` (slide change) AND re-check inside contentLoad's
    // `.then()` above via the same attachSpinner path through contentAppend.
    //
    // Actually the cleanest approach: PhotoSwipe fires contentAppend again
    // for the NEW element created by refreshSlideContent, so the listener
    // above already handles re-attachment automatically. No extra hook needed.

    // ── Clean up when holder is recycled ────────────────────────────
    pswp.on('contentRemove', (e: any) => {
      const holder = e.content?.slide?.holderElement
      if (!holder) return
      holder.querySelector('.pswp-spinner')?.remove()
      holderObservers.get(holder)?.disconnect()
      holderObservers.delete(holder)
    })

    userOnBeforeOpen?.(pswp)
  }

  return (
    <Gallery
      {...rest}
      options={{
        showHideAnimationType: 'none',
        showAnimationDuration: 0,
        hideAnimationDuration: 0,
        bgOpacity: 1,
        // User can override any of the above
        ...options,
      }}
      onBeforeOpen={handleBeforeOpen}
    >
      {children}
    </Gallery>
  )
}

// ─── AutoSizeItem ───────────────────────────────────────────────────

export type AutoSizeItemProps = Omit<ItemProps<HTMLElement>, 'width' | 'height'> & {
  /** Override width if you DO know it (bypasses auto-detection for this item) */
  width?: number | string
  /** Override height if you DO know it (bypasses auto-detection for this item) */
  height?: number | string
}

export function AutoSizeItem({
  width,
  height,
  children,
  ...rest
}: AutoSizeItemProps) {

  const w = width ?? '1'
  const h = height ?? '1'

  return (
    <Item {...rest} width={w} height={h}>
      {children}
    </Item>
  )
}