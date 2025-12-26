/**
 * Portal action - teleports an element to a target container (default: document.body)
 * This is useful for modals, tooltips, and dropdowns that need to escape overflow constraints
 */
export function portal(node: HTMLElement, target: HTMLElement | string = 'body') {
  let targetEl: HTMLElement;

  function update(newTarget: HTMLElement | string) {
    if (typeof newTarget === 'string') {
      targetEl = document.querySelector(newTarget) as HTMLElement;
      if (!targetEl) {
        console.warn(`Portal target "${newTarget}" not found`);
        return;
      }
    } else {
      targetEl = newTarget;
    }

    targetEl.appendChild(node);
  }

  update(target);

  return {
    update,
    destroy() {
      try {
        if (node && node.parentNode) {
          node.parentNode.removeChild(node);
        }
      } catch (e) {}
    },
  };
}
