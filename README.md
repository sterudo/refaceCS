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
It discovers MIDI devices and sends and receives notes. Audio is produced by the connected instrument; MIDI controls and patch storage are not yet implemented.
The surrounding page and toolbar use a dark theme; the synth retains its original light case.

## Interactive panel

- **Connect MIDI** requests ordinary browser MIDI access and lists available ports. A unique port containing "reface" is selected automatically for each direction; correct the reface input and output selections if their names differ or are ambiguous. The controller input defaults to the reface input and can be changed independently. The badge reports whether the selected reface input and output ports are available, even when a different controller is selected. Port names and manual selection do not verify hardware identity; plug/unplug changes update the display. Browser permission and a secure context are required. No SysEx permission is requested.
- On-screen keys send notes on MIDI channel 1 at velocity 100, using the displayed Octave and Transpose. The reface and selected controller inputs both illuminate matching visible keys. Notes from a separate controller are forwarded unchanged, including channel and velocity; notes from the reface itself are not echoed. Controller changes and other MIDI messages are ignored. Port changes release forwarded and on-screen notes where possible; send failures appear in the MIDI status.
- **MIDI Reset** sends All Notes Off (CC 123) and All Sound Off (CC 120) on all 16 channels to the selected output and clears the app's held-note state. Release and replay keys that were held during reset. A send failure is reported; successful submission does not confirm the synth responded.
- Five read-only floating displays sit below the toolbar and above the synth: LFO, Filter, Amp ADSR, Filter ADSR, and Effect. Dark dotted grids and cyan curves update live with the faders, including resets. Cards wrap on smaller screens without covering the instrument. The gap to the case is reduced by 75%; a fully open filter shows a flat, vertically centered response.
- These are **schematic previews**, not measured audio or calibrated Hz/millisecond curves. Both envelopes share A/D/S/R, with illustrative linear influence from EG Balance; zero amplitude-envelope influence retains a note gate, not silence. LFO shows its destination and relative depth/speed; Effect switches between echo, modulation, and distortion/tone illustrations. See the MIDI reference for verified behavior and modeling limitations.
- Display numbers are white, while their labels retain muted colors. Display backgrounds stay dark in every mode. Focus Mode colors graph lines and their shaded fills to match the sections: LFO green, Filter peach, both ADSR displays blue, and Effect pink. Relative luminance and fill opacity are preserved; turning Focus Mode off restores cyan.
- The compact toolbar includes **Hide Displays**, which removes the cards and their reserved space without changing controls or other view modes. Hidden displays continue to follow faders; Reset faders preserves their visibility.
- Each display has a subtle **reset** button for its section only. LFO resets Assign/Depth/Speed; Filter resets Cutoff/Resonance; Effect resets Type/Depth/Rate. Both ADSR reset buttons perform the same action: restore EG Balance and all A/D/S/R faders. Other sections, mute restoration, pitch-bend range, and view modes are preserved.
- One SVG panel follows the supplied reface CS reference image, with 37 individually addressable keys (optionally 61), independent faders, and OSC/looper demo LEDs.
- The CS mark is a thin, connected SVG outline path based on the reference image, not font-rendered text.
- Hold a key with a mouse, touch, Space, or Enter to animate it. Release or move focus away to release keyboard-held keys.
- Play the middle octave with **A W S E D F T G Y H U J K**, chromatically C4 through C5 at default settings. Hold/release letters for chords; the same physical QWERTY keys stay mapped to the middle keys in both keyboard views. Ctrl/Alt/Meta shortcuts and typing in editable fields do not trigger notes.
- Focus Mode overlays the mapped letters and small gray note names at the tops of all visible keys. Names follow both Octave and Transpose (default ranges C3-C6 or C2-C7), while letters stay anchored. Changing either pitch control, keyboard range, speaker layout, or fader travel releases locally held notes, as do reset, window blur, and page hiding.
- Drag a fader or focus it and use arrow keys; Shift+arrow and Page Up/Down make larger changes on continuous controls. Home moves to the top (maximum); End moves to the bottom (minimum), matching their positions on the keyboard. Hovering, keyboard focus, and dragging give the handle a brighter glow that eases in/out over 180 ms. Fader movement remains immediate. By user choice, this glow-only fade stays active with reduced motion; key and LED transitions still respect that preference.
- Hover a fader and scroll up/down to increase/decrease it by one step. Alt+wheel changes continuous faders by 10; selectors and Transpose always move one step. Shift+wheel keeps the normal single step; Shift+arrow keyboard shortcuts are unchanged. Wheel input updates graphs, readouts, LEDs, and mute handling without stealing focus. Vertical wheel scrolling is consumed only over faders, including at their limits; horizontal scrolling and Ctrl+wheel zoom remain available. Pitch Bend retains wheel adjustments like keyboard adjustments, without springing back.
- **Transpose**, between Pitch Bend and Volume, steps from -6 to +6 semitones with 0 centered. Its signed value appears above the fader in every mode, with TRANSPOSE below. It affects on-screen notes but does not alter forwarded notes or the synth's transpose setting.
- **- 12 +** beneath Pitch Bend adjusts its local range one semitone at a time, from 0 (bending disabled) to 24. Click the glowing -/+ labels or activate them with Enter/Space. Changing range preserves the bend fader position and all view modes; Reset faders restores 12 semitones, matching the user-confirmed factory default. This remains local-only and sends no MIDI.
- Double-click any fader's handle or track, or press Delete while it is focused, to restore just that fader to its Reset position without changing other controls or view modes. Both actions end any active drag on that fader.
- Click **MUTE** beneath Volume to save its level and set it to 0; **UNMUTE** restores that level only if Volume has not been touched. Touching/adjusting Volume discards the saved level, even at 0; then raise the slider to unmute. Any positive volume returns the label to MUTE. Reset clears mute state. Enter/Space also operate the label.
- Clickable selector labels and MUTE/UNMUTE have the same 180 ms fading hover glow as fader handles, including when reduced motion is enabled.
- Octave, Looper, LFO Assign, OSC Type, and Effect Type have one horizontal track line per labeled position, aligned in both travel sizes. Click a position label to select that exact step and refresh its LEDs/readout, without dragging. Repeated label clicks keep selecting that step rather than resetting it. Continuous faders retain their finer scales.
- The **2x fader travel** toggle doubles the control travel and expands the case/panel, keeping key dimensions, fader handles, labels, and values unchanged.
- **5 Octaves** adds one octave below and above the original keyboard (61 keys instead of 37). Keys narrow horizontally to fit the same frame; heights, controls, and Octave/Transpose values stay unchanged. Toggling releases held keys. This works with all view modes, and Reset faders preserves the keyboard view.
- **Hide Speakers** removes the speaker/end margins and narrows the case without resizing keys or controls. Both ends remain clickable (slim strips when compact): left lowers the Octave selector one step, right raises it, bounded at -2/+2. Enter/Space also activate focused ends. This works with Focus Mode and normal/2x travel; Reset preserves the selected layout.
- **Focus Mode** fades the still-usable Looper section to 20% opacity, adds subtle section colors, and colors the Cutoff handle red and Resonance handle blue. Pitch Bend, Volume, and Octave retain their appearance. Live gray numbers below every fader show local values (0-127; selectors 0-4; Transpose signed semitones). Toggling it preserves values; Reset and 2x preserve Focus Mode.
- **Reset faders** restores the starting positions listed in the requirements, including 50% volume, centered octave/pitch bend, maximum cutoff/decay/sustain, and other faders at the bottom. These positions also apply on page load; Reset preserves the normal/2x view.
- Looper Record/Play LEDs reflect the local looper selection only; they do not represent recording, playback, or a hardware connection.
- Only the selected OSC type's LED glows: SAW red, PULSE orange, SYNC yellow, RING lime, FM light blue. Other OSC LEDs are black. The dots sit to the right of the labels, with clearance before the Texture fader.
- On smaller screens the panel scrolls horizontally to keep controls usable.

## Tests

```powershell
npm exec playwright install chromium
npm run build
npm test
```

Browser tests cover MIDI discovery, note routing, and reset using mocked ports, plus keys, fader input and resets, selector LEDs, layout toggles, mute and pitch range, live displays, section resets, and dark/Focus Mode styling against the production build. Display checks include fully open filter geometry, section-color luminance, and responsive spacing. Real hardware behavior still requires manual verification.

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
