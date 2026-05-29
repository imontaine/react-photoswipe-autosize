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

// ─── AutoSizeGallery ────────────────────────────────────────────────

export type AutoSizeGalleryProps = Omit<GalleryProps, 'onBeforeOpen'> & {
  /** Your own onBeforeOpen handler (will be called after the auto-size hook) */
  onBeforeOpen?: GalleryProps['onBeforeOpen']
}

export function AutoSizeGallery({
  children,
  options,
  onBeforeOpen: userOnBeforeOpen,
  ...rest
}: AutoSizeGalleryProps) {
  const handleBeforeOpen: GalleryProps['onBeforeOpen'] = (pswp) => {
    // ── Filter: inject cached dimensions BEFORE slide construction ──
    // This runs every time PhotoSwipe reads item data, so if we already
    // know the dimensions from a hover preload, the slide is created
    // at the correct size from the start — no flash, no spinner.
    pswp.addFilter('itemData', (itemData: any) => {
      const src: string | undefined = itemData?.src
      if (!src) return itemData

      const cached = dimensionCache.get(src)
      if (cached) {
        // PhotoSwipe reads both .width/.height and .w/.h internally
        itemData.width = cached.w
        itemData.height = cached.h
        itemData.w = cached.w
        itemData.h = cached.h
      }
      return itemData
    })

    // ── Disable blurry thumbnail placeholder ──
    // PhotoSwipe normally scales the thumbnail (msrc) up as a blurry preview
    // while the full image loads. We disable this so the user sees our spinner
    // instead of a blur→sharp flash.
    pswp.addFilter('useContentPlaceholder', () => false)

    // ── Hook: for uncached images, start preload ──
    pswp.on('contentLoad', (e: any) => {
      const { content } = e
      const src: string | undefined = content?.data?.src
      if (!src) return

      // itemData filter already injected dimensions for this slide
      if (dimensionCache.has(src)) return

      // Start or join an in-flight preload (deduplicates hover + click)
      startPreload(src).then(() => {
        // Dimensions are now in the cache, so when refreshSlideContent
        // recreates the slide, the itemData filter will inject them.
        try {
          // Look up slide index by URL — content.slide.index may be stale
          // after rapid navigation because PhotoSwipe recycles slide elements.
          const idx = (pswp as any).getNumItems?.()
            ? Array.from({ length: (pswp as any).getNumItems() }, (_, i) => i)
                .find((i: number) => {
                  const data = (pswp as any).getItemData?.(i)
                  return data?.src === src
                })
            : content.slide?.index

          if (idx !== undefined && idx !== -1 && pswp.currSlide) {
            pswp.refreshSlideContent(idx)
          }
        } catch {
          // PhotoSwipe may have closed before preload finished — safe to ignore
        }
      })
    })

    // ── Clean up spinners when slides are recycled ──
    // holderElement is reused across slides, so remove any orphaned spinner
    // before new content is loaded into the same holder.
    pswp.on('contentRemove', (e: any) => {
      const holder = e.content?.slide?.holderElement
      const spinner = holder?.querySelector('.pswp-spinner')
      if (spinner) spinner.remove()
    })

    // ── Hook: hide image + show spinner while it's loading ──
    // Spinner is injected into holderElement (pswp__slide) rather than
    // container (pswp__zoom-wrap) so it stays viewport-centered during
    // pinch-zoom instead of scaling/panning with the image.
    pswp.on('contentAppend', (e: any) => {
      const { content } = e

      const holder: HTMLElement | undefined = content.slide?.holderElement;
      if (!holder) return;

      // Clean any orphaned spinner from a previous slide in this holder
      const stale = holder.querySelector('.pswp-spinner');
      if (stale) stale.remove();

      // ── Resolve the target <img> ──
      // When the `content` prop is used, PhotoSwipe renders arbitrary HTML and
      // content.element is the wrapper div — not an <img>. In that case we
      // search for the first <img> inside the holder instead.
      const isCustomContent = content?.data?.content != null;
      const imgEl: HTMLImageElement | null = isCustomContent ?
        holder.querySelector('img') :
        content.element instanceof HTMLImageElement ?
        content.element :
        null;

      // Already loaded at full size — nothing to do
      if (imgEl?.complete && imgEl.naturalWidth > 1) return;

      const reveal = () => {
        if (imgEl) imgEl.style.visibility = '';
        holder.querySelector('.pswp-spinner')?.remove();
      };

      if (imgEl) {
        // Standard path: <img> is already in the DOM
        imgEl.style.visibility = 'hidden';
        imgEl.addEventListener('load', reveal, {
          once: true
        });
        imgEl.addEventListener('error', reveal, {
          once: true
        });
      } else if (isCustomContent) {
        // Custom content path: the <img> may not be in the DOM yet (React
        // renders it asynchronously into the holder). Use a MutationObserver
        // to watch for it and attach the reveal listeners once it appears.
        const observer = new MutationObserver(() => {
          const img = holder.querySelector < HTMLImageElement > ('img');
          if (!img) return;
          observer.disconnect();
          if (img.complete && img.naturalWidth > 1) {
            reveal();
            return;
          }
          img.style.visibility = 'hidden';
          img.addEventListener('load', reveal, {
            once: true
          });
          img.addEventListener('error', reveal, {
            once: true
          });
        });
        observer.observe(holder, {
          childList: true,
          subtree: true
        });
      }

      holder.insertAdjacentHTML('beforeend', SPINNER_SVG);
    });

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
