/**
 * Keep the page itself from zooming. The viewport tag and `touch-action` cover Android; iPhones ignore both for
 * accessibility and send `gesture*` events for a pinch instead, which can be cancelled. Zoom is only offered where
 * it is useful (the photo viewer and the invoice), and those handle their own touches.
 */
export function blockPageZoom(target: Document = document): () => void {
  const stop = (e: Event) => e.preventDefault();
  const events = ['gesturestart', 'gesturechange', 'gestureend'];
  for (const name of events) target.addEventListener(name, stop, { passive: false });
  return () => {
    for (const name of events) target.removeEventListener(name, stop);
  };
}
