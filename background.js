// News-Distiller background.js
// The default_popup in manifest.json handles the toolbar tap natively.
// We deliberately do NOT use chrome.action.onClicked here — defining a click
// handler suppresses the default popup behavior, and chrome.action.openPopup()
// is not supported on iOS Safari, so the previous implementation resulted in
// taps doing nothing on iPhone/iPad.

chrome.runtime.onInstalled.addListener(() => {
  // Reserved for future use (e.g. setting default storage values).
});
