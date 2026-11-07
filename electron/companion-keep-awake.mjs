/** Keep this computer awake while the companion is on (moved out of main.mjs). */
export function createCompanionKeepAwake(powerSaveBlocker) {
  let companionPowerBlocker = null;

  return function syncCompanionKeepAwake(companionEnabled, keepAwake) {
    const shouldBlock = companionEnabled && keepAwake;
    if (shouldBlock && companionPowerBlocker === null) {
      companionPowerBlocker = powerSaveBlocker.start("prevent-app-suspension");
    } else if (!shouldBlock && companionPowerBlocker !== null) {
      if (powerSaveBlocker.isStarted(companionPowerBlocker)) powerSaveBlocker.stop(companionPowerBlocker);
      companionPowerBlocker = null;
    }
  }
}
