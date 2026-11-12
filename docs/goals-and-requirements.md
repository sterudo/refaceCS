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

Connect MIDI requests ordinary MIDI access; unique input and output names containing "reface" are selected automatically, with manual correction when names do not match or are ambiguous. The controller input can be selected independently. The status badge requires both selected reface ports to be available and does not verify the device's identity. Port availability updates on connection changes.

On-screen notes send on channel 1 with adjustable velocity, while external-controller velocity is preserved. Octave and transpose change outgoing app-routed notes; master transpose also controls the synth's own keyboard. Sounding-note labels appear when transpose is nonzero even outside Focus Mode. MIDI Reset sends All Notes Off and All Sound Off on all channels. Supported panel CCs and pitch bend are bidirectional; transpose, bend range, tempo, and capture use on-demand SysEx permission. Capture reports missing values and never assumes a request succeeded. The prototype decisions below describe historical stages and are superseded wherever they differ from current behavior.

The arpeggiator is an additional live-play feature below the synth. While on, it replaces on-screen and separate-controller notes with channel-1 arpeggios; reface keyboard input remains direct-playing. It supports latch (on by default), 30–300 BPM, 1/2–1/32 rates (default 1/16), a 50% gate, up/down variants without repeated endpoints, first/last/middle, and random with at most three consecutive repeats. Chord mode uses C-major diatonic triads on white keys and the preceding white key's diatonic seventh chord on black keys. Latch replaces the previous pattern when a new key is pressed after all keys are released.

The chord readout analyzes currently held on-screen notes and both selected MIDI inputs, independently of generated or latched arpeggiator notes. Recognize major, minor, augmented and diminished triads and dominant, major and minor 7th, 9th and 11th chords, including inversions and omitted fifths in extended chords. Where several chords match, prefer a root at the lowest held pitch; otherwise choose a deterministic match.

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

## Approved SVG panel prototype

The user approved implementation ("Code it") after the following decisions:

- Use one SVG panel with reusable shapes and individually addressable key, slider-handle, and LED elements; do not make a separate file for each key.
- Follow the supplied reface CS reference photo's layout, proportions, and labels, with restrained shading rather than photorealistic textures.
- Recreate the CS mark as an SVG outline path rather than text: a wide, rounded C connected along its lower stroke to the S, matching the supplied photo. Keep its proportions and keyboard-relative position unchanged in 2x travel.
- The OSC type selector runs from FM, RING, SYNC, PULSE to SAW, top to bottom (user-confirmed correction).
- Each OSC type has an LED: SAW red, PULSE orange, SYNC yellow, RING lime, FM blue. Only the selected type glows; all unselected OSC LEDs are black. LED positions follow the fader's normal/2x travel without resizing the dots.
- OSC LEDs sit to the right of their labels, with clearance before the Texture fader. Their diameter is 50% larger than the initial dots (6 rather than 4 SVG units), and FM uses a lighter blue (`#48a9ff`).
- Provide all 37 keys with held-press animation, draggable faders, and local demo LEDs.
- Octave, Looper, LFO Assign, OSC Type, and Effect Type show exactly five horizontal track lines, one aligned with each labeled position. Preserve this alignment in normal and 2x travel; leave continuous fader scales unchanged.
- Provide a "2x" toggle that doubles vertical fader travel and expands the panel/body. Keep the keyboard, handles, and labels at their original sizes and preserve the current control values.
- This stage is interactive visuals only. MIDI note/control messages, audio, actual looper operation, hardware synchronization, and patch persistence are not included.

The original illustration is in `src/synth.svg`; vanilla JavaScript wires up individual SVG elements. Key IDs retain relative panel positions; the later-approved QWERTY feature uses C4 (note 60) for the default middle C in its local pitch labels. This is a UI naming convention, not a verified hardware mapping or MIDI implementation. Discrete demo values describe slider positions; they are not MIDI CC or SysEx encodings. Looper Record and Play LEDs indicate the selected local demo mode only.

### Starting positions and Reset

The user approved these positions both on page load and when pressing **Reset faders**:

| Controls | Starting/reset position |
|---|---|
| Volume | 50%, rounded to 64 on the 0-127 scale |
| Octave | 0 (middle) |
| Pitch bend | Centered |
| Transpose | 0 semitones (middle) |
| Looper | Stop |
| Tempo | Bottom |
| LFO Assign | Off |
| LFO Depth, LFO Speed, Portamento | Bottom |
| OSC Type, Texture, Mod | Bottom (Type: SAW) |
| Filter Cutoff | Top |
| Filter Resonance | Bottom |
| EG Balance, Attack, Release | Bottom |
| Decay, Sustain | Top |
| Effect Type, Depth, Rate | Bottom (Type: Off) |

Reset preserves normal/2x travel, releases active interactions, and refreshes the control positions and local LEDs. It is not a hardware factory reset and sends no MIDI.

### Focus Mode

The user approved a visual-only **Focus Mode** toggle, off on page load:

- Fade the entire Looper section (including Tempo, labels, and demo LEDs) to 20% opacity while retaining interaction.
- Give LFO, Portamento, OSC, Filter, EG, and Effect subtle, distinct pastel backgrounds. Leave Pitch Bend, Volume, and Octave styling unchanged.
- Color the Cutoff handle red and Resonance handle blue.
- Show live mid-gray numeric readouts below every fader's labels: raw local values 0-127, 0-4 for selectors, or signed semitones for Transpose. These are demo position values, not verified MIDI encodings.
- Apply all styling/readouts only while enabled. Preserve control values when toggling, preserve Focus Mode on Reset, and support both normal and 2x travel without scaling labels or numbers.

### Hide Speakers and octave end controls

The user approved **Hide Speakers**, off on page load. Remove the speakers and shorten the left/right case margins without scaling the keyboard, fader handles, or labels. Retain slim end strips in the compact layout, with equal visible case margins on either side of the keyboard.

In every combination of speaker visibility, Focus Mode, and normal/2x travel, clicking the left end lowers the Octave selector by one step and the right end raises it. Enter or Space activates a focused end. Reuse the selector's -2 to +2 limits, handle position, accessible value, and live numeric readout; indicate unavailable steps at the limits. These are local UI changes only, not MIDI transposition or audio.

Speaker toggling preserves current values and other view toggles. Reset preserves speaker visibility and restores the Octave selector to its middle position.

### Transpose and individual fader reset

The user approved a 13-position **Transpose** fader between Pitch Bend and Volume, restricted to -6 through +6 semitones in whole-semitone steps. Its starting/reset value is 0 at the center. Show TRANSPOSE below and a live signed value (`+n`, `0`, `-n`) above, regardless of Focus Mode, speaker visibility, or travel size. Arrow keys, Shift+arrow, and Page Up/Down move one semitone; Home reaches +6 at the top and End reaches -6 at the bottom.

Transpose is independent of the Octave selector. This remains a local visual control: the documented hardware Master Transpose supports -12 to +12, but hardware synchronization and MIDI sending are not implemented.

Double-clicking any fader's handle or track, or pressing Delete while the fader has keyboard focus, restores only that fader to its defined starting/reset value and updates its handle, labels, accessible value, graphs, and selection LEDs. Both actions use the same reset handling and end any active drag on the affected fader. Apply normal Volume mute cleanup; Pitch Bend only recenters, without changing its range. Preserve other controls and all view toggles. Delete outside a focused fader must not reset anything.

### Five-octave keyboard view

The user approved a **5 Octaves** toggle, off on page load. Expand the default 37-key, three-octave range to 61 keys by adding one octave below and one above. Keep the existing relative key identities (0-5 internally). The later-approved QWERTY/note-label feature names the default ranges C3-C6 and C2-C7 respectively; this does not implement MIDI.

Fit the additional keys into the same keyboard frame by scaling only their horizontal dimension (36 white keys instead of 22). Keep key height, press animation, synth controls, Octave/Transpose settings, and other view toggles unchanged. Added white/black keys support the same pointer and keyboard interactions as the original keys.

Release held keys before switching either direction, and hide inactive extra keys from interaction and keyboard navigation. Support normal/2x travel, Focus Mode, and speaker visibility in any combination. Reset faders preserves the selected keyboard view. This remains a visual-only feature without MIDI or audio.

### Computer-keyboard notes and Focus labels

The user approved ("Code it") this physical QWERTY mapping at default Octave/Transpose settings:

| Key | A | W | S | E | D | F | T | G | Y | H | U | J | K |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Note | C4 | C#4 | D4 | D#4 | E4 | F4 | F#4 | G4 | G#4 | A4 | A#4 | B4 | C5 |

Keep the letters on the same middle physical keys in both the 37- and 61-key views, regardless of Octave/Transpose settings. Hold/release letters to press/release notes and allow chords. Ignore auto-repeat, composition, typing in editable fields, and Ctrl/Alt/Meta shortcuts; Shift is allowed. Computer-key presses, pointer presses, and focused Space/Enter presses have independent ownership, so releasing one source does not release another.

Only in Focus Mode, overlay the mapped lowercase letters and small gray note names at the very top of every visible white/black key. Keep letter proportions unchanged when the five-octave view compresses key widths. The user explicitly chose for note labels to follow **both Octave and semitone Transpose**, using sharp names. At default settings, the standard view spans C3-C6 and the extended view C2-C7; default middle C is C4 (note 60). Update accessible names and tooltips with the same pitches, while retaining internal relative key IDs.

Release all held notes when Octave or Transpose actually changes, without ending unrelated fader drags; an auto-repeat from a still-held letter must not restart a released note. Existing keyboard-range, speaker-layout, fader-travel, global-reset, window-blur, and page-hiding cleanup also releases computer-key notes. Focus Mode and display visibility alone preserve them. Labels do not intercept pointer input and follow the existing key-press animation/reduced-motion behavior. No audio or MIDI is sent.

### Clickable selector labels and fader hover

The user approved direct selection through each of the five position labels on Octave, Looper, LFO Assign, OSC Type, and Effect Type. Select the exact labeled step, focus the slider for further keyboard adjustment, and refresh the handle, accessible value, readout, LEDs, and octave end controls using the normal update path. Label presses must not start a drag, and repeated/double label clicks must keep selecting that position rather than triggering the handle/track reset shortcut.

All fader handles use the same stronger, brighter highlight on mouse hover, keyboard focus, and dragging, including while a captured drag moves outside the fader. The glow eases in and out over 180 ms, without animating or delaying handle movement. The embedded preview reports reduced motion; after confirming this was suppressing the fade, the user explicitly chose to keep the glow-only transition active even with reduced motion. Key and LED transitions still respect that preference. Hover alone must not change values. Support all view modes and leave Transpose/continuous fader labels non-interactive.

### Keyboard and mouse-wheel fader control

For every focused fader, Home moves to the top/maximum and End to the bottom/minimum, matching the keys' physical layout. Apply this mapping in every view mode to continuous faders, selectors, Pitch Bend, and signed Transpose; retain normal input synchronization and clamping.

The user approved ("Code it") wheel up/down to increase/decrease the hovered fader by one step, then changed the large-step modifier from Shift to Alt. Alt+wheel moves continuous faders by 10; five-position selectors and Transpose always move one step. Shift+wheel retains single-step movement; Shift+arrow keyboard shortcuts remain unchanged. Support the handle, track, and selector labels in all view modes.

Use the normal user-input path to clamp values and synchronize handles, accessible values, readouts, graphs, LEDs, octave end availability, and Volume mute restoration. Wheel adjustment of muted Volume at zero discards its saved level, just like other fader input. Pitch Bend retains wheel changes like keyboard input rather than recentering on hover exit.

Consume vertical wheel scrolling over faders, even at their limits, without changing keyboard focus. Leave zero-delta, predominantly horizontal, and Ctrl+wheel events untouched so normal scrolling and browser/pinch zoom remain available elsewhere.

### Label hover and Volume mute

The user approved the same 180 ms fading hover glow on clickable selector labels and the new MUTE/UNMUTE label beneath Volume. Keep the glow active under reduced motion, matching the fader glow exception. The mute label also supports keyboard focus and Enter/Space activation.

MUTE saves the current Volume value, sets Volume to 0, and changes to UNMUTE. UNMUTE restores the saved level only if Volume has not been touched since muting. The user explicitly chose that touching Volume at 0 also discards the saved level: leave UNMUTE visible but unavailable, explain that the slider must be raised, and do not restore a stale value.

Pointer adjustments, keyboard value changes, and individual-fader reset invalidate the saved level. Merely changing view modes, hovering, or operating other controls does not. Any Volume value above 0 returns the label to MUTE. Reset faders clears mute state and restores the normal Volume default. This is local UI state only; no audio or MIDI is connected.

### Pitch bend range

The user approved minus/plus labels beneath Pitch Bend with the current range centered between them. Start at 12 semitones (`- 12 +`), matching the user-confirmed factory default; each action changes the range by one semitone within 0-24, with 0 representing no bending. Disable the unavailable direction at each limit. Use the same fading label glow and Enter/Space activation as MUTE/UNMUTE.

Keep the range controls visible in every view combination and preserve their value when toggling views. Changing range must not move the pitch-bend fader or change any other control. Reset faders restores 12 semitones; double-clicking the bend fader or pressing Delete while it is focused still only recenters that fader.

The user corrected the initially assumed 2-semitone default to the factory default of 12 semitones. The hardware reference documents a signed range parameter, but this UI intentionally exposes only nonnegative range magnitudes. Hardware synchronization and MIDI sending remain unimplemented.

### Floating visualizations

The user selected all five displays: Filter response, Amp ADSR, Filter ADSR, LFO, and Effect. They selected read-only live previews driven by the existing faders, not draggable graph controls.

Reserve space below the toolbar and above the synth. Display separate floating-style dark cards with cyan graphs inspired by the supplied reference; do not overlay the instrument. The two ADSR displays share A/D/S/R settings but distinguish the influence of EG Balance. Filter responds to Cutoff and Resonance, LFO to Assign/Depth/Speed, and Effect to Type/Depth/Rate with type-specific interpretations.

The user approved implementation ("Code it") and schematic rather than hardware-calibrated curves. Show raw fader values and use relative axes rather than invented Hz/millisecond scales. At the user's request, omit the visible Schematic badges, "low-pass" from the Filter caption, and "illustrative diagram" from the Effect caption; retain the modeling caveat in documentation and accessible descriptions. Wrap cards responsively without adding document-wide horizontal scrolling.

Display LFO first, followed by Filter, Amp ADSR, Filter ADSR, and Effect. Center the Filter passband vertically; at maximum cutoff its response is completely flat with no right-edge falloff. Fade the schematic response toward that flat line near maximum cutoff. Reduce the visible gap between cards and the synth case by 75%, including both the CSS margin and the SVG's unused top gutter, without scaling the controls.

Use a dark page background, light page text, and dark toolbar buttons with distinct pressed and focus states. Leave the synth artwork and display backgrounds unchanged.

Render the actual numeric display values in white, including envelope influence percentages, while retaining muted labels. In Focus Mode, color graph lines and the shaded area beneath them using the existing panel section colors as the source of truth: LFO green, Filter peach, both ADSR displays EG blue, and Effect pink. Preserve the existing relative luminance by matching colors in linear RGB, and retain the fill's 0.07 opacity. Match graph glow and envelope marker hues as well, preserving their luminance/opacity. Restore cyan when Focus Mode is off; retain white numbers and the original dark display backgrounds in both modes. This supersedes the earlier background-tint treatment.

Use smaller toolbar buttons and add a Hide Displays toggle, off on page load. Hiding removes all five cards and their reserved layout space, but preserves fader values and other view modes. Keep updating hidden previews so showing them restores the current state. Global Reset must not change display visibility.

Provide a subtle, keyboard-operable reset button inside each display. Restore only that section's captured startup fader values: LFO Assign/Depth/Speed, Filter Cutoff/Resonance, or Effect Type/Depth/Rate. Both Amp ADSR and Filter ADSR reset buttons restore the entire shared EG section, including Balance and A/D/S/R. End active drags on affected faders, refresh related graphs/readouts/LEDs, and announce the section reset. Preserve unrelated faders, held keys, mute restoration, pitch-bend range, and all view modes.

Use the normal fader update path so dragging, keyboard changes, selector labels, double-click/Delete reset, and global Reset refresh the previews. Preserve all existing view modes and controls; graph clicks must not change values.

Model EG influence as an explicitly illustrative linear balance, not a verified Yamaha depth law. At zero AEG influence retain a note gate rather than implying silence. LFO uses an illustrative sinusoidal cycle, including an inactive trace when Assign is Off. Its OSC destination follows oscillator type. Effect shows relative echo spacing/strength for Delay, modulation cycles for Phaser and Chorus/Flanger, and an illustrative softened/clipped wave for Distortion with a dry reference. Rate means delay time, modulation rate, or tone according to Type. These are conceptual diagrams, not audio processing or simulations of the actual effect algorithms. See the visualization research in `reface-cs-midi.md` for verified manual behavior and unverified mappings.
