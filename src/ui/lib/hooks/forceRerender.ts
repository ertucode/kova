import { useState } from "react";

export function useForceRerender() {
  const [, setTick] = useState<any>(undefined);

  return () => setTick({});
}
