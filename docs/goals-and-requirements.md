# Product goals and MVP requirements

## Current direction

Build a local browser app for the Yamaha reface CS. The first release is a live visual controller with basic app-side patch save and recall.

These are decisions made during requirements refinement:

- The MVP centers on live visual control and a local Patch Manager, not the sequencer.
- The app sends MIDI control changes to the reface CS as controls are changed.
- The UI mirrors physical control changes when the synth sends MIDI feedback.
- Simple Soft Synth is a beginner-friendly browser instrument, not a hardware sound emulation. The Mode switch selects exclusive browser-synth or hardware routing for app/controller notes; switching stops held, releasing, and queued voices. Use one MIDI-connected app instance at a time to avoid independent forwarding from another tab.
- SSS supports saw with Texture-controlled octave-lower sub-oscillator volume, pulse with 50/50 to 90/10 width, filter/resonance, ADSR, OFF/AMP LFO, expression, transpose, and the displayed pitch-bend range. Unsupported hardware controls are hidden; effects are off, and hardware effect/LFO selections are restored on return. Arpeggios use audio-clock scheduling with recorded note lengths preserved; live browser latency remains device-dependent.
- The SSS logo and name open the same standard help window. Its blue branding, active SOFT button, dark blue-gradient housing, and readable inactive CS text follow the selected synth theme without changing the user-adjusted logo positions.
- Patch Manager records identify instrument type and author. The Instrument filter follows mode changes; protected System starter patches can be hidden or copied with Save as. User hardware/soft-synth patches remain separate, with instrument metadata preserved by local and cloud backups and legacy patches treated as hardware patches.
- Dismissed or Settings-hidden Messages must stay hidden even on MIDI or other errors. New hidden errors turn the Messages button background red until it is opened; opening reveals all categories without deleting history or changing the startup policy.
- The top About button sits between Connect MIDI and Settings; center the MIDI Learn row. Move the Dark Synth label 70% closer to its button, brighten cyan clickable housing/visual-toggle elements in both dark modes, and enlarge standalone housing +/- symbols by 50% without changing their actions.
- App-side patches save the current visible sound-control values; the reface CS itself does not store or recall patches.
- Patch cards show name, main category, tags, favorites, and a compact visualization of LFO-through-Effects fader values; descriptions appear in detailed view. Users can add categories and tags, and filter by favorites, category, or tag.
- The default preview is a small line-and-handle fader outline; a library-wide toggle preserves the original detailed visualization. Load sits at the top right of each card.
- Browsing supports zero, one, or multiple category/tag chips, plus case-insensitive name-contains and favorites filters. Match any selected category and any selected tag, combining filter groups with AND. Patches retain one main category.
- Selected cards support Left/Right navigation through the filtered name-sorted results, stopping at the ends and previewing audio without recalling the synth. Typing, dialogs, and synth controls retain their arrow-key behavior.
- Categories remain available when unused until explicitly deleted. The category/tag manager allows deletion of unused categories, including starters, and confirmed tag deletion removes that tag atomically from every patch. Category deletion persists across reloads.
- A patch can include up to three MP3 attachments. Selecting a card previews the first attachment; tracks can be played, reordered, and removed. An explicit play action is available if browser autoplay is blocked.
- Each patch offers browser audio recording with input selection, manual Stop, and an automatic 10-second limit. Remember the last selected input across reloads; if unavailable, select the default input with a visible warning. Encode new recordings at 256 kbps; existing attachments remain unchanged. Preview before Save MP3 or Discard; saving uses the existing three-attachment limit and IndexedDB/ZIP workflow. Audio capture and MP3 encoding stay local.
- Record first recalls the patch into the panel and sends its sound-control CC values. Open audio capture only after every value is sent successfully; unavailable MIDI, partial sends, and recall errors block recording with an explanation. Send success cannot confirm the synth applied the patch.
- Compact cards omit descriptions and the audio-count heading. Detailed snapshots shows descriptions and labeled control previews, with an explanatory tooltip. Place the hollow/yellow favorite star immediately left of Load, label metadata editing as Edit, and use accessible, tooltipped play/solid move-triangle/trash icons.
- Patch recall updates the UI and sends the supported sound controls as CC messages. MIDI Control must be enabled on the synth; unavailable output and partial send failures are reported, and a successful send is not hardware confirmation.
- A compact patch display to the left of the CS logo shows the loaded name and a colored unsaved indicator. Long names pause for five seconds before scrolling, with the full name in a tooltip. Previous/next buttons load patches in filtered name order without wrapping; if the active patch is outside the filter, navigate from the corresponding end.
- Right-clicking that display opens the current Patch Manager filtered, name-sorted names, with the loaded patch marked. Selecting loads through the normal unsaved-change guard. Support keyboard opening/navigation/dismissal, viewport-bounded scrolling, and explicit empty-library/no-match text.
- A new-patch button beside the display protects unsaved changes, then resets only patch sound controls to their initial values and shows INIT. Both display and library save buttons offer overwrite or Save as when a saved patch is active; INIT opens the new-patch editor with no previous patch to overwrite, though an existing name can be explicitly replaced.
- Protect unsaved browser-known sound controls when loading or reloading a patch: offer cancel, discard, overwrite the saved active patch, or save as before loading. Without a saved active patch, omit overwrite. Save as prepopulates metadata but does not copy audio; when changed controls overwrite a patch with audio, offer keep or delete. Deleting the active patch keeps its name as an unsaved sound; reloading the page does not automatically recall a patch. Unreported hardware changes cannot be tracked.
- Patch records and MP3 blobs use IndexedDB. The top Import / Export dialog handles versioned Patch Manager ZIP backups containing metadata and audio; imports merge into the library, skip identical items, and offer overwrite, ignore, or a separately named copy for differing matches.
- Manual Google Drive backups use a user-provided OAuth web client ID and a visible folder. Named snapshots keep audio in separate files, verify it on restore, and support merge or replace with a recovery snapshot first. Browser preferences and access tokens are not exported. Automatic cross-device sync and deletion propagation are not implemented.
- A dismissible information box above the synth explains browser storage, data-loss risks, file import/export, and manual Drive backups. A question-mark button beside Import / Export reopens it; its visibility is a browser-only preference.
- The app runs locally in a browser. Chrome or Edge is an acceptable first-release browser target.
- Use vanilla JavaScript, not TypeScript or a UI framework.
- SuperKnob is a parallel macro control, defaulting to cutoff only, positioned above OSC beside Dark Synth. Nondefault mappings glow amber. Its MIDI Learn uses the existing absolute-CC pickup/routing.
- Its movable non-modal configuration window edits one assigned parameter at a time, with absolute-value freehand/straight-line curves, enabled mappings, position preview, and independent browser-local macro preset management. Expression, pitch bend, LFO assign/depth/speed, Texture/MOD, cutoff/resonance, EG balance/A/D/S/R, and effect type/depth/rate are assignable together.
- Its configuration header includes Help, opening the standard movable/resizable non-modal help above the editor, with expandable usage and configuration sections. Escape dismisses help before configuration without cancelling an armed take.
- Recording arms one selected fader without a countdown. Its first movement starts one automatic minimum-to-maximum SuperKnob sweep over an adjustable 0.1–120 seconds (default five); capture the selected fader rather than driving it from its previous mapping. Recording duration is stored independently of playback timing. Cancelling leaves the old mapping intact.
- Outside configuration, optional automatic cycling moves back and forth with seconds-per-sweep or shared-tempo note divisions. Manual or MIDI SuperKnob movement stops it at that position, with explicit restart required. Manual assigned-fader changes remain until the next macro movement.
- CYCLE and EDIT are side by side. Configuration exposes playback timing synchronized with the standalone playback controls, but cannot run the cycle. A learned SuperKnob controller temporarily controls the selected recording fader, with selector scaling and pickup reset on target/editor changes; visible text identifies the destination.
- An opt-in C-major audition repeats middle C, E, G as eighth notes at shared tempo without changing the existing arpeggiator, starting drums, or recording into the looper. Owned notes are released on uncheck, editor close, reset, mute, patch operations, visibility/output/connection changes, and send errors. Audition state is never persisted or automatically restarted.
- Synth patches can optionally embed independent macro definitions, preserved by local ZIP and cloud patch backups. Macro preset edits never alter these copies. Recall preserves saved sound-control values rather than immediately applying the macro position, and never starts cycling.
- Saved SuperKnob presets are a standalone Import / Export dataset, included in Everything and cloud snapshots/recovery backups. Validate the complete dataset before applying any backup section; merge with the existing identical/overwrite/ignore/create-new workflow. Cloud replacement replaces an explicitly present preset list, including an empty list; legacy backups without it leave presets unchanged. Imports/restores update saved presets without loading one or changing the current unsaved macro definition, position, or include-with-patch state. Current editing/running state and MIDI Learn assignments are excluded; persistence failures must report failure without replacing the in-memory preset library.
- Deployment uses the existing JBoss static application: files and assets go under `C:\jboss\server\default\deploy\static.war\reface`, served at `https://localhost:8443/static/reface/`.

## MVP requirements

1. Show an interactive visual representation of the reface CS controls.
2. Let the user select MIDI input and output devices and show connection/permission status.
3. Send the documented CC values for supported controls when the user changes them.
4. Receive supported control changes and update the corresponding UI controls.
5. Save and edit named patch snapshots with a description, main category, free-form tags, and favorite state. Confirm duplicate-name replacement and deletion.
6. Recall a patch by first updating the panel controls, then sending supported CC values if a MIDI output is available. If unavailable, keep the local UI update and report that the synth was not updated. Continue after send failures and report partial recall.
7. Explain that physical-control feedback and control-change operation depend on the synth's MIDI Control setting.
8. Serve the app from a secure context. Web MIDI is not available from an arbitrary insecure origin; localhost is suitable for local development and use.
9. Request System Exclusive permission only for features that use SysEx. The browser requires this separately from ordinary MIDI access.
10. Display patch cards below the synth, with a responsive layout and a maximum card width of 500 px. Include filters for favorite, main category, and tag.
11. Allow up to three MP3 attachments per patch, imported through a file picker or recorded locally for up to 10 seconds after successful MIDI recall. Encode recordings at 256 kbps and preserve one or two captured channels; provide preview-before-save, playback, drag-and-drop ordering, keyboard-operable move controls, and individual removal.
12. Export and import a versioned ZIP backup that includes patch data and audio. Import merges patches and offers overwrite, ignore, or a new copy for differing matches.

## Deferred scope

- Piano-roll MIDI sequencing and fader automation; the phrase looper and drum step sequencer are implemented.
- Full-text search across metadata beyond patch names.
- A saved or generated image of a patch's fader/control state.
- Settings and additional live-play workflow.
- Cross-platform support beyond the chosen Chrome/Edge browser target.
- Automated changing of system settings until each setting's behavior and safety are validated.

## Research and design questions

- Confirm the MIDI Data List values against a Yamaha-hosted copy before implementing message generation.
- Test whether the reface CS transmits each panel parameter change over USB MIDI with MIDI Control enabled, and how it behaves when MIDI Control is disabled.
- Verify whether parameter requests or bulk-dump requests provide a reliable way to initialize the UI from the instrument. Do not assume a successful send means the synth state has been read back.
- Implemented storage uses IndexedDB; browser data can still be cleared or is limited to its origin/profile, so backups remain important.
- Verify the actual USB-MIDI device names and hot-plug behavior on the target Windows setup.
- SysEx parameter-change recall remains a possible later option. The MVP uses CC, and actual hardware response still requires manual verification.

## Browser and MIDI constraints

Web MIDI requires a secure context and explicit user permission. Chrome and Chromium-based Edge support the API; SysEx access requires the app to request the additional `sysex` permission. A local app should be served from localhost rather than opened as a `file://` document.

Connect MIDI requests ordinary MIDI access and independently attempts to enable Groove Studio audio; an audio failure is reported without blocking MIDI connection. Unique input and output names containing "reface" are selected automatically, with manual correction when names do not match or are ambiguous. The controller input can be selected independently. The status badge requires both selected reface ports to be available and does not verify the device's identity. Port availability updates on connection changes.

When a selected reface connection becomes available, read device settings and then capture supported current synth parameters automatically. Ask how to handle unsaved sound edits before capturing; cancellation preserves them. Captured values reflect the current sound, not necessarily the physical fader positions after loading a patch. Report missing values and do not overwrite newer edits made during capture.

Device settings attempts a non-blocking SysEx read on MIDI connection and provides explicit retry and staged changes with per-setting read-back status; missing replies remain unknown, and a successful send is not confirmation. Panel transmit/receive channels, Local Control and speaker controls send immediately; assumed and unconfirmed values are marked. A specific receive channel routes outgoing notes and controls to that channel; All preserves forwarded and recorded channels while generated messages use channel 1. Changing receive channel stops playback and releases notes before sending. Synth input is accepted on all channels. The dialog also covers MIDI Control, Auto Power-Off, Master Tune, signed pitch-bend range and MIDI tone-generator volume; pedal options are experimental. Changes can disrupt communication or sound. Reset prepares only verified defaults, without sending or performing a factory reset. The hardware guide links to the owner's power-on key and setting-confirmation diagrams and warns that factory reset erases the hardware loop. Device settings are not restored automatically or included in backups. Changing connections clears device values and pending edits.

The panel pitch-bend range remains a nonnegative magnitude. Device readings always update the displayed range; the app does not restore a saved range to the synth. Before sending a change, read the current direction or explicitly choose one when reading fails; zero does not encode a direction. Offline edits affect the display only and are not restored. Hardware response and the effect of signed ranges remain to be verified.

The separate external controller forwards pitch bend and CCs unchanged on their original MIDI channels, unless an explicit MIDI Learn assignment consumes that source. Supported synth controls are mirrored in the panel without echo. Place MIDI Learn, Assignments, Clear assignment, Modulation value and position-sensitive expression in one vertically centered, wrapping row with 8px gaps; reuse the top MIDI toolbar's compact button padding and select styling. Remove the old controller modulation-wheel target selector and ignore its saved setting. The Modulation value slider sends standard CC 1 on the active receive channel, or channel 1 when receive is All, and follows incoming unremapped CC 1 only. It remains independent of hardware MIDI Learn assignments, other synth faders and patch capture. Synth input feedback is never forwarded back as controller input. Active forwarded sustain is released on controller/output changes, MIDI Reset, or page hiding where possible.

MIDI Learn targets only the on-screen synth faders, including discrete selectors and local octave/looper controls. Enable a toggle, move an on-screen fader to select it, then move an absolute CC control on the selected separate controller to assign it. Show the pending target and assignment result; consume the assignment message without forwarding its original CC. Stay in Learn mode for repeated assignments until disabled; reface feedback and other sections cannot select targets. Support ordinary absolute CC 0-119, not relative encoders, Note On, pitch-bend messages or channel-mode CCs. Channel-mode messages retain their normal routing. Learned channel-10 CCs are handled before the separate drum-input routing.

Persist assignments per input port ID, incoming channel and CC as browser-only preferences, not as patch data or in file/cloud backups. Learning a duplicate source replaces that source's target; allow individual assignments to be cleared. Learned CC 1 assignments affect only that hardware source; clearing restores unchanged CC 1 forwarding. Release previously forwarded sustain when learning its source. Learned values scale over the target's complete range and use the same local behavior and MIDI/SysEx path as the on-screen control; preserve incoming channel when receive is All. Require pickup at or across the current browser-known value before taking over, re-arming after other value changes, patch recall, reload and reconnect. Do not persist Learn mode; disable it on controller changes or loss. Report invalid saved mappings and storage/send failures.

On-screen notes send on channel 1 with velocity 100, while external-controller velocity is preserved. The Expression fader sends channel-1 CC 11 from 0 to 127 (default 127); optional mouse/touch position sensitivity changes the fader and the channel-wide expression when a key is pressed. MUTE remains app-only and does not change expression. Octave and transpose change outgoing app-routed notes; master transpose also controls the synth's own keyboard. Sounding-note labels appear when transpose is nonzero even outside Focus Mode. The arpeggiator's controls and note/chord readouts sit beside the YAMAHA logo; the tempo fader and arpeggiator share 40–240 BPM and reset to 120 when the arpeggiator is enabled or its display is double-clicked. Captured synth tempos outside this range are reported without changing the controls or the synth. MIDI Reset sends All Notes Off and All Sound Off on all channels. Supported panel CCs and pitch bend are bidirectional; transpose, bend range, tempo, and capture use on-demand SysEx permission. Capture reports missing values and never assumes a request succeeded. The prototype decisions below describe historical stages and are superseded wherever they differ from current behavior.

The arpeggiator is an additional live-play feature integrated into the synth panel. While on, it replaces on-screen and separate-controller notes with channel-1 arpeggios; reface keyboard input remains direct-playing. It supports latch (on by default), 40–240 BPM, 1/2–1/32 rates (default 1/16), a 50% gate, up/down variants without repeated endpoints, first/last/middle, and random with at most three consecutive repeats. Chord mode uses C-major diatonic triads on white keys and the preceding white key's diatonic seventh chord on black keys. Latch replaces the previous pattern when a new key is pressed after all keys are released.

The UI phrase looper is independent of the hardware looper and records notes from on-screen keys, the reface keyboard, and the selected controller; when the arpeggiator is active, it records generated notes rather than the held app/controller inputs. CLEAR erases the temporary phrase, REC arms the first recording until a note starts it, and PLAY finishes it and starts looping. CLEAR → PLAY → REC bypasses the standby guide, which is approximated using the synth's current sound. Subsequent REC overdubs immediately; PLAY ends overdubbing without restarting the phrase. PAUSE resumes from the paused position, following the manual's phrase-looper operation page; STOP rewinds. Record/Play LEDs reflect transport activity, and the looper shares the 40–240 BPM tempo. The limits are 2,000 notes and 1,200 beats; controller changes are not recorded. MIDI Reset, output changes or loss, and hiding the page stop playback without erasing the phrase. Playback and guide are silenced by MUTE, while the transport continues. Hardware operation and the precise guide sound remain unverified.

Looper automation controls below the slider default to 4/4, zero bars, and quantization off. Click the signature to toggle 4/4 and 3/4, use −/+ for a length up to the 1,200-beat limit, and cycle or open the quantization menu for note divisions 1 through 32. Zero bars retains manual recording. A fixed-length first take starts on the first note, counts down the remaining bars, and wraps into overdubbing until PLAY is selected; early PLAY starts the full-length loop with empty remaining space. The countdown repeats during overdubbing. Recorded note starts are quantized to the nearest grid point while retaining their duration; live notes remain immediate and quantized overdubs are heard on a subsequent pass. Settings changed during a phrase apply to the next new recording.

For notes on the same MIDI channel and pitch, a newer overdub at the same quantized position replaces the previous duration. A later note start cuts the preceding duration, including across the loop boundary. All app-routed same-channel/pitch retriggers send Note Off before Note On instead of stacking voices; a subsequent release of the interrupted note does not cut the newer one.

Looper load/save icons use a named browser-stored loop library; an adjacent icon opens the loop import/export dialog. Import accepts native JSON and beat-timed type 0 or synchronized type 1 MIDI. Export asks for a filename and offers native JSON or pure MIDI; JSON preserves exact length, while pure MIDI omits app-specific length metadata and may lose trailing silence. Older looper MIDI files with that metadata remain importable. MIDI imports report ignored non-note events and unsupported or later tempo/signature changes; the initial tempo applies only within 40–240 BPM and the signature only for 3/4 or 4/4. General MIDI files end at the next bar after their last note. Loading confirms replacement and leaves the phrase stopped. Exporting during recording or overdubbing finalizes held and scheduled notes and stops the transport; cancelling leaves recording active. Files over 2,000 notes, 1,200 beats, or 16 MB are rejected.

The chord readout analyzes currently held on-screen notes and both selected MIDI inputs, independently of generated or latched arpeggiator notes. Recognize major, minor, augmented and diminished triads and dominant, major and minor 7th, 9th and 11th chords, including inversions and omitted fifths in extended chords. Major chords are green and minor chords blue; augmented, diminished and dominant chords remain neutral. Where several chords match, prefer a root at the lowest held pitch; otherwise choose a deterministic match.

### Groove studio and MIDI shutdown

A collapsible Groove studio between the synth and Patch Manager provides an 808-inspired, sample-free Web Audio drum machine. New patterns have kick, snare, closed hi-hat, and open hi-hat lanes; additional voices include three toms, shaker, clap, crash and ride. Each pattern has 1–16 bars in a horizontally scrolling grid, with 16 sixteenth-note steps per bar in 4/4 or 12 in 3/4. Shortened bars and hidden 3/4 steps are preserved. Lanes provide solo/mute, five velocity levels, per-lane options, and Level, Tune, Decay and Tone. Reusable instrument-specific tone variations support save, load, preview, name filtering, favorites, sorting and individual JSON import/export. Protect modified tones before loading; patterns retain independent tone snapshots. Patterns and tone variations persist in browser storage and are included in Groove Studio backups, while older backups remain importable. Pure MIDI export includes active bars and all lanes on channel 10, but omits tone settings, mute/solo and hidden steps.

Each bar can copy or immediately clear the visible steps of soloed lanes, or all lanes when none are soloed. Paste immediately overwrites only copied instrument lanes in the target bar, adds missing lanes with default tone settings, and leaves steps outside the visible range of either meter unchanged. The in-page clipboard is not persisted.

Drums accept channel-10 MIDI triggering and share tempo and meter with the browser looper. Once drum audio is enabled, looper MIDI uses timestamped look-ahead scheduling on the shared musical timeline. Linked starts join the next available bar; linked Pause/Clear also stops drums. Explicit Stop always stops both transports and performs MIDI Reset, even when linking is unchecked. Space toggles drum play/stop except where existing synth keys, editing, dialogs, or other controls handle it.

MIDI Reset stops note producers, clears arpeggiator held/latch input without changing its enabled/latch/chord settings, clears queued MIDI, sends Sustain Off on all 16 channels and explicit tracked Note Offs, then sends All Notes Off and All Sound Off on all channels. Stop finalizes elapsed recording time silently, without playing overdue notes or restoring a playback pass at a recording boundary. Failed queue cancellation and message submission remain visible; successful sends do not confirm the physical synth response.

The signed looper MIDI offset is adjustable from -600 to +600 ms; positive values delay playback MIDI, without delaying live input. Calibrate MIDI offset plays a standalone 100 BPM kick and keeps only the latest reface Note On delay measured from the kick's scheduled playback time. Done applies that delay positively; Cancel or an error preserves the old value. This aligns playing/input delay, not measured hardware audio latency.

Groove output can be internal audio, external MIDI or both. MIDI uses a separately selected port and channel (default 10), shared global lane-note mappings, and separate mappings per CS2x Performance. Preset CS2x XG kits and drum Performances, selectable Performance banks, and custom bank/program values are available. Choosing a CS2x XG/SFX kit selects channel 10; choosing a Performance selects channel 1, with subsequent manual overrides allowed. Show the selected sound beside MIDI settings and an inline reverb slider sending CC91 to that output/channel. No sound/reverb is reapplied on reconnect or instrument mode changed automatically. Lane Level scales external velocity, including sequence, preview and controller hits; Level zero suppresses external note-ons. In Internal + MIDI mode, scheduled external notes receive the signed looper offset too; external-only and live hits remain uncompensated. Cancel pending events and release notes on stop, routing/sound changes and disconnection. Routing and reverb preferences are browser-local and excluded from backups; older preferences without reverb remain valid. Standalone software can use a virtual MIDI port as both Groove output and synth input, with matching channels and an appropriate synth sound. The separate MIDI adapter was hardware-confirmed to trigger the CS2x; the tested reface setup did not act as USB-to-DIN MIDI thru.

External MIDI-only lane options retain Level while hiding internal Tune, Decay and Tone controls, tone names, and tone Save/Load/Import/Export actions. Keep lane preview, solo/mute and removal available. Restore internal controls in Internal and Internal + MIDI modes without altering lane settings or saved tone data.

An inline Octave selector shifts every external drum note by -3 to +3 octaves (default 0), including sequence, preview and live hits, without modifying base lane mappings or internal audio. Persist the shift per existing mapping: shared standard/XG, separate CS2x Performances. Release active external notes and replace queued hits when changed, without stopping the transport or cancelling internal audio. Report and skip shifted notes outside MIDI 0-127; never clamp or wrap them. Older preferences without octave settings remain valid and use zero shift.

An optional browser-local Start on keypress checkbox starts stopped drums from the first melodic Note On on the on-screen keyboard or selected reface/controller inputs, without stopping on release or retriggering an already running/pending start. Honor transport linking, and exclude controller drum notes, calibration notes, note-offs and generated notes. The arpeggiator shares the absolute Groove beat grid at every supported rate and through tempo changes, while standalone arpeggios retain immediate onset. Key-triggered simultaneous drum/arpeggiator starts use a common first beat.

Browser-supported audio output selection applies only to drums. Web Audio requests interactive latency but cannot host native VSTs or directly expose ASIO. Physical interface latency, MIDI shutdown, and reface response require hardware verification. Piano-roll sequencing and fader automation remain deferred; the browser-based saw/pulse Simple Soft Synth is implemented.

Sources:

- [MDN: Web MIDI API](https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API)
- [Chrome Developers: MIDI permission prompt](https://developer.chrome.com/blog/web-midi-permission-prompt)
- [Yamaha reface support and downloads](https://usa.yamaha.com/musical-instruments/keyboards/products/synthesizers/reface/support.html)

## Implementation technology stack

| Layer | Choice | Purpose |
|---|---|---|
| UI | Vanilla JavaScript (ES modules), HTML, and CSS | Synth controls and patch UI using native browser APIs; no TypeScript or UI framework |
| Build tooling | Vite | Local development server and static production build |
| Synth panel | SVG with accessible HTML controls | Scalable panel visuals with keyboard-operable controls |
| MIDI | Native Web MIDI API | Direct browser-to-device CC and SysEx communication |
| Local storage | IndexedDB | Patch data and imported audio blobs |
| Backup | Versioned ZIP containing JSON metadata and MP3 blobs | Portable patch backups independent of browser storage |
| Tests | Playwright | Browser workflow and UI tests with mocked MIDI |
| Runtime | Chrome or Edge, served by the existing JBoss static application | Local browser application with MIDI permission |

No application backend, Python service, or database server is needed for the MVP. Node.js is used for development/build tooling and can also serve the built static files locally; MIDI communication and patch storage remain in the browser.

### Deployment to JBoss

The confirmed deployment target is `C:\jboss\server\default\deploy\static.war\reface`, with the entry URL `https://localhost:8443/static/reface/`. JBoss serves static HTML, JavaScript, CSS, and other assets; no Java application endpoints are required.

Configure Vite's production asset base as `/static/reface/` and deploy the contents of its build output directory into that folder. Avoid root-relative application URLs that would incorrectly point outside `/static/reface/`. Verify that the directory URL without a trailing slash redirects correctly, JavaScript modules have a valid JavaScript MIME type, and the HTTPS certificate is trusted by the browser. Confirm Web MIDI is available and the page is a secure context on the actual deployment.

IndexedDB belongs to the origin (`https://localhost:8443`), not the `/static/reface/` path. Use application-specific database names; other applications on the same origin share its security boundary. Vite development and JBoss production have separate browser storage when their origins differ; use ZIP patch export/import to transfer data.

Browser storage is tied to the origin and browser profile and can be cleared, so a stable localhost origin and explicit patch backup/export are important. Ordinary web apps cannot silently access arbitrary local MP3 paths; audio attachments use a file picker. Automated tests cannot replace validation with the actual reface CS.

### Audio previews without a backend

The browser can import up to three user-selected MP3 files per patch, store their bytes as Blobs in IndexedDB, and play them using an HTML audio element and temporary object URLs. This is a local import, not an upload to a server. Selecting another patch or preview should stop the previous preview; release object URLs when no longer needed.

Recording uses `getUserMedia` and `MediaRecorder` with a requested capture bitrate of 256 kbps, then decodes the capture with Web Audio and encodes up to 10 seconds to 256 kbps MP3 with `@breezystack/lamejs`. The last selected audio-input ID is stored in localStorage for this browser origin, separately from patch backups. If the input is missing, select the default and warn; preference-storage errors are visible and do not prevent recording. Stop capture tracks after recording, on errors, when discarding/closing, and on page exit; release preview object URLs as well. Require HTTPS or localhost and microphone permission, and surface unavailable inputs, capture/encoding errors, and storage failures. The reface CS needs its audio outputs connected to an audio interface; USB MIDI provides no audio. Native recording formats vary by browser, so unsupported capture/decoding must report an error rather than save mislabeled audio.

Audible autoplay is subject to browser policy. An explicit "Enable previews" action can initiate playback, but the app must still handle rejected playback attempts and offer a Play button. Playback after each patch selection must be tested in the supported browsers; automatic playback on initial page load cannot be guaranteed.

Audio storage consumes the browser origin's quota and writes can fail. Show storage/import errors and do not claim a file was saved before the write succeeds. Stored files do not automatically synchronize between browsers or computers. JSON patch exports alone do not back up MP3 bytes; full-library backup needs a format that includes both patch metadata and audio files (for example, a ZIP archive). A backend is unnecessary for this local workflow; optional manual Drive backups upload saved audio only when requested.

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

- Keep the Looper section (including Tempo, labels, and LEDs) fully visible and interactive.
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
