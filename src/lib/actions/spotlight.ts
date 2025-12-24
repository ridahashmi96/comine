// Minimal spotlight effect - tracks mouse globally, updates CSS vars on elements

let mouseX = 0;
let mouseY = 0;
let isTracking = false;
const elements = new Set<HTMLElement>();

function updateElements() {
  elements.forEach(el => {
    const rect = el.getBoundingClientRect();
    const x = ((mouseX - rect.left) / rect.width) * 100;
    const y = ((mouseY - rect.top) / rect.height) * 100;
    el.style.setProperty('--spotlight-x', `${x}%`);
    el.style.setProperty('--spotlight-y', `${y}%`);
  });
}

function onMouseMove(e: MouseEvent) {
  mouseX = e.clientX;
  mouseY = e.clientY;
  requestAnimationFrame(updateElements);
}

function startTracking() {
  if (isTracking) return;
  isTracking = true;
  document.addEventListener('mousemove', onMouseMove, { passive: true });
}

function stopTracking() {
  if (elements.size > 0) return;
  isTracking = false;
  document.removeEventListener('mousemove', onMouseMove);
}

export function spotlight(node: HTMLElement) {
  elements.add(node);
  node.classList.add('spotlight');
  startTracking();

  return {
    destroy() {
      elements.delete(node);
      node.classList.remove('spotlight');
      stopTracking();
    }
  };
}

export function spotlightBorder(node: HTMLElement) {
  elements.add(node);
  node.classList.add('spotlight-border');
  startTracking();

  return {
    destroy() {
      elements.delete(node);
      node.classList.remove('spotlight-border');
      stopTracking();
    }
  };
}
