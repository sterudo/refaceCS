# refaceCS
Manager for the Yamaha refaceCS Synthesizer 

## Development

Requires Node.js 20.19+ or 22.12+ (or a newer supported release) and npm.

```powershell
npm install
npm run dev
```

Open the localhost URL printed by Vite, including `/static/reface/`.
The current page is an interactive SVG panel built with vanilla JavaScript, HTML, and CSS.
It discovers MIDI devices, routes notes, and synchronizes documented synth controls. Audio is produced by the connected instrument; patch storage is not yet implemented.
The surrounding page and toolbar use a dark theme; the synth retains its original light case.

## Interactive panel

- **Connect MIDI** requests ordinary browser MIDI access and lists available ports. A unique port containing "reface" is selected automatically for each direction; correct the reface input and output selections if their names differ or are ambiguous. The controller input defaults to the reface input and can be changed independently. The badge reports port availability, not verified hardware identity. No settings are sent on connect.
- Supported panel controls send channel-1 CC or pitch bend; physical synth CC feedback updates the panel without echo. Enable MIDI Control on the synth; its status is reported when read. Master transpose, pitch-bend range and tempo use SysEx, so their first use requests extra browser permission. The tempo fader and arpeggiator share a 40–240 BPM range and send exact BPM values to the synth.
- **Capture Synth** requests supported parameter values over SysEx and reports missing, invalid, or unavailable values. A captured synth tempo outside the shared 40–240 BPM range is reported and left unchanged. It cannot capture expression, physical volume, octave, looper, or pitch-bend position. A successful send is not confirmation from the hardware. Hardware response behavior still needs verification.
- **Expression** sends CC 11 on channel 1, ranging from 0 to 127 (default/reset 127). On-screen notes use a fixed velocity of 100. Optionally enable position-sensitive expression for mouse/touch: each new key press sets expression and updates the fader, with the bottom 20% at 127. CC 11 affects all sounding notes on that channel, including held notes; it is not per-note volume. Synth and controller CC 11 feedback updates the fader without echoing synth input.
- The app transposes on-screen, external-controller, and arpeggiator notes; it also sets the synth's master transpose for its own keyboard. External-controller channel and velocity are preserved; synth notes are not echoed. Notes shifted outside the MIDI range are skipped and reported. Port changes release forwarded and on-screen notes where possible; send failures appear in MIDI status.
- A separate **Controller input** forwards pitch bend and all CC messages on their incoming channels; supported controls also update the panel without echo. Its modulation wheel (CC 1) defaults to filter cutoff (CC 74), replacing rather than duplicating CC 1. Choose any target CC in **Modulation wheel**, or select **CC 1 — Pass through** to leave it unchanged. The mapping is remembered in the current browser and applies only to the separate controller, not the reface input. The adjacent slider sends the selected CC on channel 1 and follows matching controller, synth, and panel changes. Switching CCs sends nothing and displays the last known value, or retains the slider position if unknown; initial panel values are not a hardware capture. Forwarded CCs may not all be supported by the synth. Active controller sustain is released on controller/output changes, MIDI Reset, or page hiding where possible. If a mapped sustain remains active when changing CCs, a warning explains how to release it.
- **MIDI Reset** sends All Notes Off (CC 123) and All Sound Off (CC 120) on all 16 channels to the selected output, releases any active controller sustain, and clears the app's held-note state. Release and replay keys that were held during reset. A send failure is reported; successful submission does not confirm the synth responded.
- **Arpeggiator**, beside the YAMAHA logo, replaces on-screen and separate-controller notes with a channel-1 pattern while enabled; the reface's own keyboard remains direct-playing. Its ON button lights red when enabled, and Latch and Chord light amber when active. The output preserves each source note's velocity. Switch it off to resume notes still held. Its shared tempo resets to 120 BPM on activation or by double-clicking the display. Click −/+ for one BPM, Shift-click for ten, or use the wheel over the display (Alt for ten). Rate and Mode cycle on click; right-click, Arrow Down, or Shift+F10 opens their full menus. Rates run from 1/2 to 1/32 (default 1/16), with a 50% note gate. Up/down and down/up do not repeat turning points; first/last/middle alternates lowest and highest toward the center. Random repeats a note at most three times; a single-note pattern pauses for one step after three repeats.
- **Latch**, on by default, keeps playing after release and replaces the pattern on the first new key after all keys are released. **Chord** expands white keys into C-major diatonic triads (C major, D minor, E minor, F major, G major, A minor, B diminished); each black key plays the diatonic seventh chord rooted at the white key to its left (for example C-sharp plays Cmaj7). Notes above MIDI 127 are omitted. MIDI Reset, output changes, and hiding the page stop the pattern and clear held/latch state.
- **Phrase looper** runs in the browser independently of the synth's hardware looper. Select CLEAR, then REC to arm; the first note starts recording. The standby guide uses a short MIDI note and the synth's current sound; select CLEAR → PLAY → REC to skip it. Select PLAY to finish the first take and loop it, REC to overdub, and PLAY to finish overdubbing. PAUSE resumes from the paused position; STOP rewinds. CLEAR erases the phrase.
- Beneath the looper, click **4/4** to toggle 4/4 and 3/4, use **− / +** to set the bar length, and click the final value to cycle note-start quantization (0/off, 1, 2, 4, 8, 16, 32); right-click or use Arrow Down for the full menu. The default **4/4 − 0 + 0** retains manual looper behavior. A nonzero bar length counts down from the first note, then wraps into overdubbing until PLAY is selected. Selecting PLAY early starts the fixed-length loop immediately, leaving unrecorded space empty. The countdown repeats on each recording pass.
- Quantization moves recorded starts to the nearest note division, preserving each note's duration; live playing remains immediate, and quantized overdubs become audible on a subsequent loop. Settings changed during an existing phrase apply to the next new recording, not the current phrase. The 1,200-beat limit allows up to 300 bars in 4/4 or 400 in 3/4.
- For the same MIDI channel and pitch, an overdub at an existing start replaces its duration. A later start cuts the preceding note short, including across the loop boundary. Loop retriggers send note-off before note-on; releasing the interrupted note cannot cut the newer one.
- The icons beside **LOOPER** load and save Standard MIDI Files without requiring a MIDI connection. Save prompts for a filename (default `reface-loop.mid`) and adds `.mid` if needed; the browser chooses the download location. Loading replaces an existing phrase only after confirmation and leaves the new phrase stopped. Type 0 and synchronized type 1 files with beat-based timing are supported; type 2 and SMPTE timing are not. Imports retain note channels, velocities, and durations but ignore and report non-note MIDI events. The initial file tempo is applied if it is within 40–240 BPM; supported 3/4 or 4/4 signatures are applied, while unsupported values and later changes are reported and ignored. Other files loop to the next bar after the last note; this looper's exports preserve the exact loop length, including trailing silence, when reloaded. Exported note positions and durations use 1/9,600-beat resolution. Saving during recording or overdubbing stops the transport and finalizes held and scheduled notes.
- The looper records on-screen keys, the selected external controller and reface keyboard, or generated arpeggiator notes rather than their held input keys. The reface keyboard still plays directly; its transmitted note numbers are recorded unchanged. Only notes are recorded, not controller changes; playback uses the current synth sound and the shared tempo. Up to 2,000 notes and 1,200 beats (ten minutes at 120 BPM) fit in one temporary phrase. Record and Play LEDs show the local transport state and beat, not the hardware looper. The guide's pitch and duration are approximations, not verified hardware values.
- MIDI Reset, output loss/change, and hiding the page stop the looper and release its app-routed notes where possible; the phrase remains until CLEAR or page reload. MUTE silences looper playback while its timing continues. The synth's locally played keys cannot be controlled independently of MIDI playback.
- The arpeggiator's notes and chord readouts reflect currently held on-screen, reface, and selected-controller notes, not released latched notes or generated chord tones. The chord detector recognizes major, minor, augmented and diminished triads, and dominant, major and minor 7th, 9th and 11th chords, including inversions and extended chords with an omitted fifth. Major chords are green and minor chords blue; augmented, diminished and dominant chords remain neutral. It prefers a match rooted on the lowest held note; otherwise it selects one deterministic match. Other note combinations show no chord.
- Five read-only floating displays sit below the toolbar and above the synth: LFO, Filter, Amp ADSR, Filter ADSR, and Effect. Dark dotted grids and cyan curves update live with the faders, including resets. Cards wrap on smaller screens without covering the instrument. The gap to the case is reduced by 75%; a fully open filter shows a flat, vertically centered response.
- These are **schematic previews**, not measured audio or calibrated Hz/millisecond curves. Both envelopes share A/D/S/R, with illustrative linear influence from EG Balance; zero amplitude-envelope influence retains a note gate, not silence. LFO shows its destination and relative depth/speed; Effect switches between echo, modulation, and distortion/tone illustrations. See the MIDI reference for verified behavior and modeling limitations.
- Display numbers are white, while their labels retain muted colors. Display backgrounds stay dark in every mode. Focus Mode colors graph lines and their shaded fills to match the sections: LFO green, Filter peach, both ADSR displays blue, and Effect pink. Relative luminance and fill opacity are preserved; turning Focus Mode off restores cyan.
- The compact toolbar includes **Hide Displays**, which removes the cards and their reserved space without changing controls or other view modes. Hidden displays continue to follow faders; Reset faders preserves their visibility.
- Each display has a subtle **reset** button for its section only. LFO resets Assign/Depth/Speed; Filter resets Cutoff/Resonance; Effect resets Type/Depth/Rate. Both ADSR reset buttons perform the same action: restore EG Balance and all A/D/S/R faders. Other sections, mute restoration, pitch-bend range, and view modes are preserved.
- One SVG panel follows the supplied reface CS reference image, with 37 individually addressable keys (optionally 61), independent faders, OSC selector LEDs, and looper transport LEDs.
- The CS mark is a thin, connected SVG outline path based on the reference image, not font-rendered text.
- Hold a key with a mouse, touch, Space, or Enter to animate it. Release or move focus away to release keyboard-held keys.
- Play the middle octave with **A W S E D F T G Y H U J K**, chromatically C4 through C5 at default settings. Hold/release letters for chords; the same physical QWERTY keys stay mapped to the middle keys in both keyboard views. Ctrl/Alt/Meta shortcuts and typing in editable fields do not trigger notes.
- Focus Mode overlays the mapped letters and small gray note names at the tops of all visible keys. Note names also appear outside Focus Mode whenever transpose is nonzero. Names follow both Octave and Transpose (default ranges C3-C6 or C2-C7), while letters stay anchored. Changing octave, keyboard range, speaker layout, or fader travel releases locally held notes, as do reset, window blur, and page hiding.
- Drag a fader or focus it and use arrow keys; Shift+arrow and Page Up/Down make larger changes on continuous controls. Home moves to the top (maximum); End moves to the bottom (minimum), matching their positions on the keyboard. Hovering, keyboard focus, and dragging give the handle a brighter glow that eases in/out over 180 ms. Fader movement remains immediate. By user choice, this glow-only fade stays active with reduced motion; key and LED transitions still respect that preference.
- Hover a fader and scroll up/down to increase/decrease it by one step. Alt+wheel changes continuous faders by 10; selectors and Transpose always move one step. Shift+wheel keeps the normal single step; Shift+arrow keyboard shortcuts are unchanged. Wheel input updates graphs, readouts, LEDs, and mute handling without stealing focus. Vertical wheel scrolling is consumed only over faders, including at their limits; horizontal scrolling and Ctrl+wheel zoom remain available. Pitch Bend retains wheel adjustments like keyboard adjustments, without springing back.
- **Transpose**, between Pitch Bend and Expression, ranges from -12 to +12 semitones. It controls the synth's master transpose and shifts app-routed MIDI notes; held direct notes are released at their original pitch.
- **- 12 +** beneath Pitch Bend controls the synth's nonnegative bend range from 0 to 24 semitones. Reset restores 12.
- Double-click any fader's handle or track, or press Delete while it is focused, to restore just that fader to its Reset position without changing other controls or view modes. Both actions end any active drag on that fader.
- **MUTE** releases app-routed notes and suppresses new ones without changing expression; the arpeggiator keeps its timing. It cannot mute notes played directly on the synth. Reset clears mute state.
- Clickable selector labels and MUTE/UNMUTE have the same 180 ms fading hover glow as fader handles, including when reduced motion is enabled.
- Octave, Looper, LFO Assign, OSC Type, and Effect Type have one horizontal track line per labeled position, aligned in both travel sizes. Click a position label to select that exact step and refresh its LEDs/readout, without dragging. Repeated label clicks keep selecting that step rather than resetting it. Continuous faders retain their finer scales.
- The **2x fader travel** toggle doubles the control travel and expands the case/panel, keeping key dimensions, fader handles, labels, and values unchanged.
- **5 Octaves** adds one octave below and above the original keyboard (61 keys instead of 37). Keys narrow horizontally to fit the same frame; heights, controls, and Octave/Transpose values stay unchanged. Toggling releases held keys. This works with all view modes, and Reset faders preserves the keyboard view.
- **Hide Speakers** removes the speaker/end margins and narrows the case without resizing keys or controls. Both ends remain clickable (slim strips when compact): left lowers the Octave selector one step, right raises it, bounded at -2/+2. Enter/Space also activate focused ends. This works with Focus Mode and normal/2x travel; Reset preserves the selected layout.
- **Focus Mode** fades the still-usable Looper section to 20% opacity, adds subtle section colors, and colors the Cutoff handle red and Resonance handle blue. Pitch Bend, Expression, and Octave retain their appearance. Live gray numbers show fader values; hover tooltips include CC numbers where available.
- **Reset faders** restores starting positions, including expression 127, centered octave/pitch bend, maximum cutoff/decay/sustain, and other faders at the bottom. Resets send supported values to the synth; page load does not.
- Only the selected OSC type's LED glows: SAW red, PULSE orange, SYNC yellow, RING lime, FM light blue. Other OSC LEDs are black. The dots sit to the right of the labels, with clearance before the Texture fader.
- On smaller screens the panel scrolls horizontally to keep controls usable.

## Tests

```powershell
npm exec playwright install chromium
npm run build
npm test
```

Browser tests cover MIDI discovery, note and controller routing, modulation-wheel mapping, reset, looper transport and recording, MIDI file import/export, and arpeggiator timing and patterns using mocked ports, plus keys, fader input and resets, selector LEDs, layout toggles, mute and pitch range, live displays, section resets, and dark/Focus Mode styling against the production build. Display checks include fully open filter geometry, section-color luminance, and responsive spacing. Real hardware behavior still requires manual verification.

## Build and deploy

```powershell
npm run build
```

Copy the **contents** of `dist` into `C:\jboss\server\default\deploy\static.war\reface`.
Open `https://localhost:8443/static/reface/` in Chrome or Edge with a trusted HTTPS certificate.
The build uses `/static/reface/` as its asset base; JBoss only needs to serve the generated static files.
Do not deploy `node_modules` or run Vite on JBoss.

To inspect the production build locally, run `npm run preview` and open its printed URL at `/static/reface/`.

## Goals
- MVP: a local browser app that visually controls the reface CS and sends MIDI CC in real time
- Mirror physical control changes when the synth sends MIDI feedback
- Save and recall basic app-side patches (the synth itself has no patch storage)
- Later: full patch library, basic MIDI sequencer, settings, and live-play features

## Research / Ideas to be discussed with AI before coding
- [Product goals and MVP requirements](docs/goals-and-requirements.md)
- [reface CS MIDI and System Exclusive reference](docs/reface-cs-midi.md)
- **Macro control:** A knob or slider, similar to the MODX Super Knob, that morphs multiple synth sliders together and can be mapped to an external controller's modulation wheel.
- **Step sequencer:** A piano-roll sequencer that supports both notes and fader movements.
- **Programmable slider:** A slider whose MIDI CC number can be freely selected.
- **Chord guide:** Select a chord from a dropdown; pressing its root highlights the chord's keys without playing sound.
