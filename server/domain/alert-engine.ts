export type AlertZone = "safe" | "lower" | "upper";

export interface AlertState {
  armed: boolean;
  zone: AlertZone;
}

export interface AlertEvent {
  side: "lower" | "upper";
  threshold: number;
  currentPrice: number;
}

export function evaluateAlert(
  previous: AlertState,
  currentPrice: number,
  lowerThreshold: number,
  upperThreshold: number,
): { state: AlertState; event: AlertEvent | null } {
  if (lowerThreshold >= upperThreshold) {
    throw new Error("下限预警值必须小于上限预警值");
  }

  const zone: AlertZone = currentPrice <= lowerThreshold
    ? "lower"
    : currentPrice >= upperThreshold
      ? "upper"
      : "safe";

  if (zone === "safe") {
    return { state: { armed: true, zone }, event: null };
  }

  if (!previous.armed) {
    return { state: { armed: false, zone }, event: null };
  }

  return {
    state: { armed: false, zone },
    event: {
      side: zone,
      threshold: zone === "lower" ? lowerThreshold : upperThreshold,
      currentPrice,
    },
  };
}
