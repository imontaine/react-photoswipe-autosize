/**
 * AutoSizeGallery — PhotoSwipe without image dimensions
 * ──────────────────────────────────────────────────────
 * Drop-in replacements for <Gallery> and <Item> from react-photoswipe-gallery
 * that automatically detect image dimensions at runtime.
 *
 * HOW IT WORKS:
 * 1. Each <AutoSizeItem> renders without dimensions
 * 2. An `itemData` filter injects cached dimensions before slides are created
 * 3. For uncached images, `contentLoad` fires a background preload
 * 4. Any slide whose content was sized before its dimensions resolved —
 *    including lazily preloaded neighbours — is refreshed once the real
 *    dimensions are known, so PhotoSwipe marks it zoomable
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
      // Cache the fallback as well — `contentLoad` compares cached
      // dimensions against the content size, so leaving it uncached would
      // retry (and refresh) forever for a broken image.
      const dims = { w: 800, h: 600 }
      dimensionCache.set(src, dims)
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

/** Single source of truth for a slide's image URL. */
function resolveSrc(data: any): string | undefined {
  return data?.src ?? data?.original
}

/** True when the item already declares real, usable dimensions. */
function hasDimensions(data: any): boolean {
  const w = Number(data?.w ?? data?.width)
  const h = Number(data?.h ?? data?.height)
  return Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0
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
    imgEl.addEventListener('load', () => reveal(imgEl), { once: true })
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
      const src = resolveSrc(itemData)
      if (!src) return itemData

      // Explicit dimensions win — never overwrite them.
      if (hasDimensions(itemData)) return itemData

      const cached = dimensionCache.get(src)
      if (!cached) return itemData

      return {
        ...itemData,
        width: cached.w,
        height: cached.h,
        w: cached.w,
        h: cached.h,
      }
    })

    // ── Disable blurry thumbnail placeholder ────────────────────────
    pswp.addFilter('useContentPlaceholder', () => false)

    // ── Refresh slides created before their dimensions were known ───
    // A slide (or its lazy preload) can be constructed while the image
    // dimensions are still unknown, so PhotoSwipe sizes it from stale or
    // missing dimensions. That leaves it non-zoomable: `pswp--zoom-allowed`
    // is never added and pinch-zoom stays disabled after swiping to it.
    const pendingRefreshes = new Set<number>()

    const scheduleRefresh = (index: number) => {
      if (pendingRefreshes.has(index)) return
      pendingRefreshes.add(index)

      // Deferred: contentLoad fires while the slide is mid-append and
      // refreshing there would destroy the content being loaded.
      setTimeout(() => {
        pendingRefreshes.delete(index)
        if (pswp.isDestroying || !pswp.mainScroll) return

        try {
          pswp.refreshSlideContent(index)
        } catch (error) {
          console.error('Failed to refresh PhotoSwipe content', error)
        }
      }, 0)
    }

    const refreshIfOutdated = (
      content: { width: number; height: number; index: number },
      dims: { w: number; h: number },
    ) => {
      if (content.width === dims.w && content.height === dims.h) return
      scheduleRefresh(content.index)
    }

    // ── Resolve dimensions for uncached slides ──────────────────────
    pswp.on('contentLoad', ({ content }: any) => {
      const src = resolveSrc(content?.data)
      if (!src) return

      // Explicit dimensions win — never reload or refresh their slides.
      if (hasDimensions(content?.data)) return

      const cached = dimensionCache.get(src)
      if (cached) {
        // The content may have been cached by a lazy preload that ran
        // before the dimensions were resolved, so its size can be stale
        // even though the dimensions are now known.
        refreshIfOutdated(content, cached)
        return
      }

      const index = content.index

      startPreload(src)
        .then((dims) => {
          const itemData = (pswp as any).getItemData?.(index)

          // Verify the data source still matches — avoids refreshing
          // the wrong slide when duplicate image URLs are present.
          if (!itemData || resolveSrc(itemData) !== src) return

          refreshIfOutdated(content, dims)
        })
        .catch(() => {
          // Preload failure — safe to ignore
        })
    })

    // ── Wire up spinner on initial slide mount ──────────────────────
    pswp.on('contentAppend', (e: any) => {
      const { content } = e
      const src = resolveSrc(content?.data)
      if (!src) return

      const holder: HTMLElement | undefined = content.slide?.holderElement
      if (!holder) return

      attachSpinner(content, holder, holderObservers)
    })

    // ── Re-wire spinner after refreshSlideContent recreates element ─
    // PhotoSwipe fires `contentAppend` again for the NEW element created
    // by refreshSlideContent, so the listener above already handles
    // re-attachment automatically. No extra hook needed.

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
  return (
    <Item {...rest} width={width} height={height}>
      {children}
    </Item>
  )
}
