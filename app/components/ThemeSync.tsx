"use client";

import { useEffect } from "react";
import { THEME_CHANGE_EVENT, applyThemeToDocument, getStoredThemeId } from "../lib/theme";

export default function ThemeSync() {
  useEffect(() => {
    const syncTheme = () => {
      applyThemeToDocument(getStoredThemeId());
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key && event.key !== "feicai-settings") return;
      syncTheme();
    };

    const handleThemeChange = () => {
      syncTheme();
    };

    syncTheme();
    window.addEventListener("storage", handleStorage);
    window.addEventListener(THEME_CHANGE_EVENT, handleThemeChange);

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(THEME_CHANGE_EVENT, handleThemeChange);
    };
  }, []);

  return null;
}
