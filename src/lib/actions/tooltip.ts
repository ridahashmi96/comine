// Custom tooltip action - replaces native title with styled tooltip

let tooltipEl: HTMLDivElement | null = null;
let currentTarget: HTMLElement | null = null;
let showTimeout: ReturnType<typeof setTimeout> | null = null;
let hideTimeout: ReturnType<typeof setTimeout> | null = null;

function createTooltip() {
  if (tooltipEl) return;
  tooltipEl = document.createElement('div');
  tooltipEl.className = 'tooltip';
  tooltipEl.style.cssText = `
    position: fixed;
    z-index: 9999;
    padding: 6px 10px;
    background: rgba(30, 30, 30, 0.95);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    color: rgba(255, 255, 255, 0.9);
    font-size: 12px;
    font-family: 'Jost', sans-serif;
    pointer-events: none;
    opacity: 0;
    transform: translateY(4px);
    transition: opacity 0.15s, transform 0.15s;
    white-space: normal;
    word-wrap: break-word;
    max-width: min(300px, calc(100vw - 32px));
    text-align: center;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  `;
  document.body.appendChild(tooltipEl);
}

function isElementInDOM(element: HTMLElement): boolean {
  return document.body.contains(element);
}

function showTooltip(target: HTMLElement, text: string) {
  if (!text) return;
  
  // Check if target element is still in the DOM
  if (!isElementInDOM(target)) {
    hideTooltip();
    return;
  }
  
  createTooltip();
  if (!tooltipEl) return;

  currentTarget = target;
  tooltipEl.textContent = text;

  const rect = target.getBoundingClientRect();
  
  // If element is not visible (at 0,0 with no size), don't show tooltip
  if (rect.width === 0 && rect.height === 0) {
    hideTooltip();
    return;
  }
  
  // Need to get tooltip dimensions after setting content
  // Temporarily show it off-screen to measure
  tooltipEl.style.visibility = 'hidden';
  tooltipEl.style.opacity = '0';
  tooltipEl.style.top = '-9999px';
  tooltipEl.style.left = '-9999px';
  
  // Force a reflow to get accurate dimensions
  const tooltipRect = tooltipEl.getBoundingClientRect();

  // Position below by default, above if not enough space
  let top = rect.bottom + 8;
  let left = rect.left + (rect.width - tooltipRect.width) / 2;

  // Keep within viewport vertically
  if (top + tooltipRect.height > window.innerHeight - 8) {
    top = rect.top - tooltipRect.height - 8;
  }
  // If still not enough space above, position below anyway
  if (top < 8) {
    top = rect.bottom + 8;
  }
  
  // Keep within viewport horizontally
  if (left < 8) left = 8;
  if (left + tooltipRect.width > window.innerWidth - 8) {
    left = window.innerWidth - tooltipRect.width - 8;
  }

  tooltipEl.style.visibility = 'visible';
  tooltipEl.style.top = `${top}px`;
  tooltipEl.style.left = `${left}px`;
  tooltipEl.style.opacity = '1';
  tooltipEl.style.transform = 'translateY(0)';
}

function hideTooltip() {
  if (!tooltipEl) return;
  tooltipEl.style.opacity = '0';
  tooltipEl.style.transform = 'translateY(4px)';
  currentTarget = null;
}

export function tooltip(node: HTMLElement, text?: string) {
  let tooltipText = text || node.getAttribute('title') || '';
  
  // Remove native title to prevent double tooltip
  if (node.hasAttribute('title')) {
    node.removeAttribute('title');
  }

  function onEnter() {
    // Don't show if element is being removed or not visible
    if (!isElementInDOM(node)) return;
    
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
    showTimeout = setTimeout(() => {
      // Double-check element is still in DOM when timeout fires
      if (isElementInDOM(node)) {
        showTooltip(node, tooltipText);
      }
    }, 400);
  }

  function onLeave() {
    if (showTimeout) {
      clearTimeout(showTimeout);
      showTimeout = null;
    }
    hideTimeout = setTimeout(hideTooltip, 100);
  }

  node.addEventListener('mouseenter', onEnter);
  node.addEventListener('mouseleave', onLeave);
  node.addEventListener('focus', onEnter);
  node.addEventListener('blur', onLeave);

  return {
    update(newText: string) {
      tooltipText = newText;
      if (currentTarget === node && tooltipEl) {
        tooltipEl.textContent = newText;
      }
    },
    destroy() {
      node.removeEventListener('mouseenter', onEnter);
      node.removeEventListener('mouseleave', onLeave);
      node.removeEventListener('focus', onEnter);
      node.removeEventListener('blur', onLeave);
      if (showTimeout) clearTimeout(showTimeout);
      if (hideTimeout) clearTimeout(hideTimeout);
      // Always hide tooltip when the node is destroyed
      if (currentTarget === node) {
        hideTooltip();
      }
    }
  };
}
