# Pake desktop comparison

- Reuse the current React renderer, preload contract, DesktopAppStore, and pi runtime.
- Package the local Pake checkout with the Taosi host plugin; do not substitute the old Tauri application.
- Keep the Pake build workspace generated and ignored. Do not modify the Pake checkout or user history.
- The native bridge only accepts local application documents. External pages must never gain backend access.
- Verify the packaged macOS WebView and real Node sidecar. Electron tests alone do not prove this host.
- Keep separate application identity and app state for side-by-side comparison.
