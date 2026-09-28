// Ask the background worker to inject element-hiding CSS for this frame.
// Injection happens via chrome.scripting.insertCSS so the styles use the
// "user" origin and can't be overridden by the page.
chrome.runtime.sendMessage({ type: 'cosmetic', url: location.href }).catch(() => {});
