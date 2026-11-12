# Product goals and MVP requirements

## Current direction

Build a local browser app for the Yamaha reface CS. The first release is a live visual controller with basic app-side patch save and recall.

These are decisions made during requirements refinement:

- The MVP centers on live visual control, not the sequencer or full patch library.
- The app sends MIDI control changes to the reface CS as controls are changed.
- The UI mirrors physical control changes when the synth sends MIDI feedback.
- The MVP saves and recalls basic synth control states as app-side patches. The reface CS itself does not store or recall patches.
- The app runs locally in a browser. Chrome or Edge is an acceptable first-release browser target.
- Use vanilla JavaScript, not TypeScript or a UI framework.
- Deployment uses the existing JBoss static application: files and assets go under `C:\jboss\server\default\deploy\static.war\reface`, served at `https://localhost:8443/static/reface/`.

## MVP requirements

1. Show an interactive visual representation of the reface CS controls.
2. Let the user select MIDI input and output devices and show connection/permission status.
3. Send the documented CC values for supported controls when the user changes them.
4. Receive supported control changes and update the corresponding UI controls.
5. Save, name, load, and delete patch snapshots in app-managed local storage.
6. Recall a patch by sending its supported parameter values to the connected synth. Clearly report when MIDI is unavailable or a send fails.
7. Explain that physical-control feedback and control-change operation depend on the synth's MIDI Control setting.
8. Serve the app from a secure context. Web MIDI is not available from an arbitrary insecure origin; localhost is suitable for local development and use.
9. Request System Exclusive permission only for features that use SysEx. The browser requires this separately from ordinary MIDI access.

## Deferred scope

- MIDI sequencer and transport workflow.
- Full patch-library metadata: description, category, tags, favorites, and search/filtering by name and those fields.
- Up to three locally stored MP3 attachments per patch.
- Users import ("upload") MP3 files through a file picker. When browsing patches, the first attachment should play automatically when browser autoplay policy permits; users can select either of the other attachments. Provide an explicit play action if autoplay is blocked.
- A saved or generated image of a patch's fader/control state.
- Settings and additional live-play workflow.
- Choosing SVG (one synth illustration or separate control illustrations) remains a design option, not a requirement.
- Cross-platform support beyond the chosen Chrome/Edge browser target.
- Automated changing of system settings until each setting's behavior and safety are validated.

## Research and design questions

- Confirm the MIDI Data List values against a Yamaha-hosted copy before implementing message generation.
- Test whether the reface CS transmits each panel parameter change over USB MIDI with MIDI Control enabled, and how it behaves when MIDI Control is disabled.
- Verify whether parameter requests or bulk-dump requests provide a reliable way to initialize the UI from the instrument. Do not assume a successful send means the synth state has been read back.
- Decide local patch storage and backup/export behavior. IndexedDB is a candidate for browser-managed local storage.
- Verify the actual USB-MIDI device names and hot-plug behavior on the target Windows setup.
- Decide whether patch recall should use CC, SysEx parameter changes, or a tested combination. The manual documents both mechanisms; their behavior should be tested on hardware.

## Browser and MIDI constraints

Web MIDI requires a secure context and explicit user permission. Chrome and Chromium-based Edge support the API; SysEx access requires the app to request the additional `sysex` permission. A local app should be served from localhost rather than opened as a `file://` document.

Sources:

- [MDN: Web MIDI API](https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API)
- [Chrome Developers: MIDI permission prompt](https://developer.chrome.com/blog/web-midi-permission-prompt)
- [Yamaha reface support and downloads](https://usa.yamaha.com/musical-instruments/keyboards/products/synthesizers/reface/support.html)

## Recommended technology stack (proposed, not yet decided)

| Layer | Recommendation | Purpose |
|---|---|---|
| UI | Vanilla JavaScript (ES modules), HTML, and CSS | Synth controls and patch UI using native browser APIs; no TypeScript or UI framework |
| Build tooling | Vite | Local development server and static production build |
| Synth panel | SVG with accessible HTML controls | Scalable panel visuals with keyboard-operable controls |
| MIDI | Native Web MIDI API | Direct browser-to-device CC and SysEx communication |
| Local storage | IndexedDB via Dexie | Patch data and, later, imported audio blobs |
| Backup | Versioned JSON import/export | Portable patch backups independent of browser storage |
| Tests | Vitest; Playwright for browser workflows | Protocol/state tests and UI tests with mocked MIDI |
| Runtime | Chrome or Edge, served by the existing JBoss static application | Local browser application with MIDI permission |

No application backend, Python service, or database server is needed for the MVP. Node.js is used for development/build tooling and can also serve the built static files locally; MIDI communication and patch storage remain in the browser.

### Deployment to JBoss

The confirmed deployment target is `C:\jboss\server\default\deploy\static.war\reface`, with the entry URL `https://localhost:8443/static/reface/`. JBoss serves static HTML, JavaScript, CSS, and other assets; no Java application endpoints are required.

Configure Vite's production asset base as `/static/reface/` and deploy the contents of its build output directory into that folder. Avoid root-relative application URLs that would incorrectly point outside `/static/reface/`. Verify that the directory URL without a trailing slash redirects correctly, JavaScript modules have a valid JavaScript MIME type, and the HTTPS certificate is trusted by the browser. Confirm Web MIDI is available and the page is a secure context on the actual deployment.

IndexedDB belongs to the origin (`https://localhost:8443`), not the `/static/reface/` path. Use application-specific database names; other applications on the same origin share its security boundary. Vite development and JBoss production have separate browser storage when their origins differ; use patch export/import to transfer data.

Browser storage is tied to the origin and browser profile and can be cleared, so a stable localhost origin and explicit patch backup/export are important. Ordinary web apps cannot silently access arbitrary local MP3 paths; later audio attachments need file selection/import or an explicitly approved filesystem-access design. Automated tests cannot replace validation with the actual reface CS.

### Audio previews without a backend

The browser can import up to three user-selected MP3 files per patch, store their bytes as Blobs in IndexedDB, and play them using an HTML audio element and temporary object URLs. This is a local import, not an upload to a server. Selecting another patch or preview should stop the previous preview; release object URLs when no longer needed.

Audible autoplay is subject to browser policy. An explicit "Enable previews" action can initiate playback, but the app must still handle rejected playback attempts and offer a Play button. Playback after each patch selection must be tested in the supported browsers; automatic playback on initial page load cannot be guaranteed.

Audio storage consumes the browser origin's quota and writes can fail. Show storage/import errors and do not claim a file was saved before the write succeeds. Stored files do not automatically synchronize between browsers or computers. JSON patch exports alone do not back up MP3 bytes; full-library backup needs a format that includes both patch metadata and audio files (for example, a ZIP archive). A backend is unnecessary for this local workflow, but would be needed for server-hosted sharing or synchronization.
