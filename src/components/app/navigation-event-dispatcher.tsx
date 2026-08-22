"use client";

import { useEffect } from "react";

import { APP_NAVIGATION_START } from "@/lib/navigation-events";

/**
 * Announces normal same-origin links before Next's App Router handles them.
 * Debounced URL updates on the outgoing page can then be cancelled instead of
 * replacing the user's destination route while it is still loading.
 */
export function NavigationEventDispatcher() {
  useEffect(() => {
    const announce = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        !(event.target instanceof Element)
      ) {
        return;
      }

      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!link || link.target || link.hasAttribute("download")) return;

      const destination = new URL(link.href, window.location.href);
      if (
        destination.origin !== window.location.origin ||
        (destination.pathname === window.location.pathname && destination.search === window.location.search)
      ) {
        return;
      }

      window.dispatchEvent(new Event(APP_NAVIGATION_START));
    };

    document.addEventListener("click", announce, true);
    return () => document.removeEventListener("click", announce, true);
  }, []);

  return null;
}
