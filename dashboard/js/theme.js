// The sliding highlight shared by every segmented control.

/** The highlight slides between choices instead of jumping; it follows whichever button has class "on". */
export function slidingThumbs(root) {
  for (const seg of root.querySelectorAll('.s-seg')) {
    const thumb = Object.assign(document.createElement('i'), { className: 'thumb' }); thumb.setAttribute('aria-hidden', 'true'); seg.prepend(thumb);
    const move = () => {
      const on = seg.querySelector('button.on'), shown = on && on.offsetWidth;
      thumb.style.opacity = shown ? 1 : 0;
      if (shown) { thumb.style.width = on.offsetWidth + 'px'; thumb.style.transform = `translateX(${on.offsetLeft}px)`; }
    };
    new MutationObserver(move).observe(seg, { subtree: true, attributes: true, attributeFilter: ['class'] });
    new ResizeObserver(move).observe(seg); move();
  }
}
