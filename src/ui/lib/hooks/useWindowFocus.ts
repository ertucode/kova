import { useEffect } from "react";
import { getWindowElectron } from "@/getWindowElectron";

/**
 * Hook that calls a callback when the window regains focus
 * @param callback Function to call when window is focused
 */
export function useWindowFocus(callback: () => void) {
  useEffect(() => {
    const unsubscribe = getWindowElectron().onWindowFocus(callback);
    return unsubscribe;
  }, [callback]);
}
