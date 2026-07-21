"use client";

import { useEffect } from "react";
import useThemeStore from "@/store/themeStore";

export function ThemeProvider({ children }) {
  const { initTheme } = useThemeStore();

  useEffect(() => {
    initTheme();
    if (typeof document !== "undefined") {
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => {
          document.documentElement.classList.add("fonts-loaded");
        });
      } else {
        document.documentElement.classList.add("fonts-loaded");
      }
    }
  }, [initTheme]);

  return <>{children}</>;
}
