const paragraph = (text) => ({ type: 'p', text });
const heading = (text) => ({ type: 'h3', text });
const list = (...items) => ({ type: 'ul', items });
const item = (label, text) => ({ label, text });
const link = (label, href) => ({ label, href });
const details = (summary, blocks) => ({ type: 'details', summary, blocks });

const effectType = list(
  item('DIST', 'Distortion.'),
  item('CHO / FLA', 'Chorus / Flanger.'),
  item('PHASER', 'Phaser.'),
  item('DELAY', 'Delay.'),
  item('OFF', 'Passes the sound through unchanged.'),
  'Only one effect type is selected at a time.',
);
const effectDepth = paragraph('Depth controls the selected effect’s intensity (wet/dry amount). The audible result depends on the selected effect type.');
const effectRate = list(
  item('DIST', 'Changes distortion tone.'),
  item('CHO / FLA', 'Sets modulation rate.'),
  item('PHASER', 'Sets modulation rate.'),
  item('DELAY', 'Sets delay time.'),
  item('OFF', 'No effect; Rate has no audible effect.'),
);
const filterDescription = [
  paragraph('The reface CS uses a resonant low-pass filter.'),
  list(
    item('Cutoff', 'Sets the frequency above which the filter reduces sound. Lower settings make the sound darker; higher settings let more upper harmonics through.'),
    item('Resonance', 'Emphasizes the sound around the cutoff point and can produce a strong resonant tone.'),
  ),
  paragraph('The live graph is schematic; it does not report calibrated frequency or an exact hardware response.'),
];

export const helpContent = {
  versions: {
    title: 'Version History',
    wide: true,
    blocks: [
      paragraph('Dates follow the commits introducing each version. The v0.1 summary also includes improvements made before v0.2.'),
      heading('v0.13 - 2026-11-17'),
      paragraph('Mobile header actions move into a hamburger side menu. In landscape the menu opens from the housing itself, with Focus, Glissando, and Reset inside; the synth fills the viewport width with equal slim housing edges. Compact fader controls and touch-sized key widths stay fixed as the viewport narrows, while black keys are 20% shorter than their standard proportions. Shortened top controls and the compact arpeggiator align left, with patch controls immediately beside the arpeggiator and SuperKnob following or wrapping below on narrow screens. Tap the patch display to open the existing patch selector. Independently pannable faders and the five-octave keyboard remain available. Overall key height adapts to vertical space; very short screens scroll vertically rather than shrinking the controls further. Optional touch and mouse glissando remains available. Note/chord readouts, original controls, and the top-mounted SuperKnob remain on desktop. Compact view actions include tooltips; Speakers and Displays highlight when visible.'),
      heading('v0.12 - 2026-11-17'),
      paragraph('Simple Soft Synth browser instrument with saw/sub-oscillator and pulse-width controls, filter, ADSR, AMP LFO, adjustable pitch-bend range, exclusive instrument routing, and audio-scheduled arpeggios. Includes SSS help, blue theme-aware branding and mode button, protected System starter patches, and shared hardware/soft-synth patch management with instrument-aware backups.'),
      heading('v0.11 - 2026-11-16'),
      paragraph('SuperKnob macro mappings with a movable curve editor, movement-triggered recording with adjustable duration, independently timed or tempo-synced cycling, MIDI Learn with temporary selected-fader control in configuration, C-major audition at shared tempo, independent macro presets with standalone/Everything/cloud backups, and optional embedded patch definitions.'),
      heading('v0.10 - 2026-11-16'),
      paragraph('Settings for dark synth appearance, startup and MIDI behavior, Groove Studio defaults, patch loading and audio visibility, plus a reset that preserves saved data.'),
      heading('v0.8 - 2026-11-16'),
      paragraph('Contextual help, consolidated playing tips, centralized notifications, pinned top controls, and dated version history.'),
      heading('v0.7 - 2026-11-15'),
      paragraph('MIDI Learn with pickup and saved controller mappings, plus compact MIDI controls and standard modulation-wheel output.'),
      heading('v0.6 - 2026-11-15'),
      paragraph('External drum MIDI routing, CS2x kits and Performances, editable note mappings, and shared arpeggiator timing.'),
      heading('v0.5 - 2026-11-15'),
      paragraph('Editable device settings, receive-channel-aware MIDI routing, and automatic synth capture with unsaved-edit protection.'),
      heading('v0.4 - 2026-11-15'),
      paragraph('Multi-bar Groove Studio patterns, expanded drum voices, reusable instrument tones, bar editing, and audio-output selection.'),
      heading('v0.3 - 2026-11-15'),
      paragraph('Loaded-patch display, unsaved-change tracking, filtered patch navigation, INIT, and overwrite/Save as choices.'),
      heading('v0.2 - 2026-11-15'),
      paragraph('Local ZIP and manual Google Drive backups for saved patches, loops, and Groove Studio data.'),
      heading('v0.1 - 2026-11-12'),
      paragraph('Initial synth panel, MIDI and arpeggiator, browser looper, Patch Manager with MP3 recording, and synthesized drums.'),
    ],
  },
  about: {
    title: 'About refaceCS',
    wide: true,
    blocks: [
      paragraph('refaceCS is a browser-based companion for the Yamaha reface CS. It provides an on-screen instrument panel, MIDI control, a browser-based Simple Soft Synth, patch organization, a browser phrase looper, an arpeggiator, and a sample-free drum Groove Studio. It does not replace the instrument or store patches in the hardware.'),
      heading('Getting started'),
      list(
        'Open the app in a supported Chromium browser over HTTPS or localhost. Choose Connect MIDI and grant permission.',
        'Select the reface MIDI input and output. If you use a separate controller, select its input independently.',
        'Enable MIDI Control on the reface when using the panel faders. A successful MIDI send does not prove that the instrument applied it.',
        'Use the Mode switch for Simple Soft Synth when hardware is unavailable. It plays through browser audio without MIDI; latency depends on the browser and audio device.',
        'Play with the on-screen keys, a connected controller, or the reface keyboard. Save sounds to the Patch Manager if you want to recall them later.',
      ),
      heading('Playing and panel controls'),
      list(
        'Hold keys to press them.',
        'Drag faders, scroll the wheel over one, or focus one and use arrow keys.',
        'Alt+wheel makes larger changes on continuous faders.',
        'Home sets the top; End sets the bottom. Double-click or press Delete on a focused fader to reset it.',
        'A W S E D F T G Y H U J K plays the middle octave; hold multiple letters for chords.',
        'Focus Mode shows letters and transposed note names.',
        'Click the left/right ends to shift octave down/up.',
        'Looper LEDs show the UI looper state, not the hardware looper.',
      ),
      heading('Features'),
      list(
        'Adjust supported reface CS sound controls and map absolute controller knobs and sliders with MIDI Learn.',
        'Switch to Simple Soft Synth for saw/pulse sounds with filter, envelope, and LFO controls. It shares the keyboard, arpeggiator, and looper; it is not intended to reproduce the hardware sound.',
        'Save, tag, filter, recall, import, and export browser-side patches. A patch stores the app’s known sound-control values, not every hardware state.',
        'Record and play app-side phrases, quantize note starts, set fixed loop lengths, and save named loops in this browser.',
        'Generate arpeggios and use Groove Studio for browser audio drums or external MIDI drums.',
        'Export and import library data, or optionally make manual Google Drive backups.',
      ),
      heading('Messages and appearance'),
      list(
        'About sits between Connect MIDI and Settings. The MIDI Learn controls are centered beneath the synth.',
        'Hidden Messages stay hidden even for MIDI or other errors. A red Messages button indicates a new error; open it to restore the normal button background and show all categories. Message history remains available for this page session.',
        'Dark Synth brightens cyan actions on and above the housing in both dark modes. The housing + and - controls have larger symbols without changing their actions.',
      ),
      heading('Limitations'),
      list(
        'Web MIDI requires a secure context and browser permission; SysEx features request additional permission. MIDI support varies by browser and device.',
        'The app phrase looper is separate from the reface hardware looper. Browser data is tied to this browser profile and site address; it is not automatically synced.',
        'The reface USB MIDI connection does not carry audio. Audio recording requires an audio interface, microphone permission, and HTTPS or localhost.',
        'A MIDI send or available port does not confirm that the hardware received or applied a setting. Some device behavior and timing still need hardware verification.',
        'Parameter graphs are schematic illustrations, not measured audio, calibrated Hz/ms readouts, or simulations of the instrument.',
        'The app cannot independently mute notes played directly on the reface or capture every hardware state, including expression, physical volume, octave, looper phrase, or pitch-bend position.',
      ),
    ],
  },
  superknob: {
    title: 'SuperKnob',
    wide: true,
    blocks: [
      paragraph('SuperKnob is one macro control for several synth parameters. Each assigned parameter has its own absolute-value curve, so turning one knob can open the filter, reduce resonance, change modulation, and shape effects together. The default mapping controls Cutoff only; custom mappings give the knob an amber glow. Edits apply live to the panel and selected MIDI output.'),
      details('Getting started and playing the macro', [
        list(
          'Connect MIDI, select the reface output, and enable MIDI Control on the instrument to hear parameter changes. Without an output, you can still configure and preview values on screen.',
          'Find SuperKnob above OSC, beside Dark Synth. Drag vertically, use the wheel, or focus it and use the arrow keys for single steps and Page Up / Page Down for ten steps. Alt+wheel also makes ten-step changes. Home sets the maximum; End sets the minimum.',
          'Open configuration with EDIT, Configure, a double-click, or a right-click on the knob. With the knob focused, Shift+F10 or the context-menu key also opens it.',
          'Choose a Parameter and press + Assign parameter. Select its row to edit its curve. All enabled mappings respond together when the macro moves; selecting a row does not solo it.',
          'Try Cutoff rising from low to high and Resonance falling from high to low. Move Preview position to hear the combined result, optionally using the C-major audition.',
          'A manual change to an assigned fader remains until the macro next moves. Curves set exact values, not offsets from the current sound.',
        ),
      ]),
      details('Parameters and curve editing', [
        list(
          item('Assignable controls', 'Expression, Pitch bend, LFO assign/depth/speed, Texture, Modulation, Cutoff, Resonance, EG balance/attack/decay/sustain/release, and Effect type/depth/rate. A parameter can be assigned only once.'),
          item('Axes', 'The horizontal axis is SuperKnob position, from 0 to 127. The vertical axis is the selected parameter value. Continuous controls use 0 to 127; LFO assign and Effect type use their five selector positions, 0 to 4. Pitch bend is neutral at 64.'),
          item('Draw', 'Drag across the graph to draw freehand. The app interpolates between pointer positions and stores 128 samples per curve.'),
          item('Straight line', 'Select Straight line, then drag between two points to replace that segment with a rising, falling, or flat line.'),
          item('Exact points', 'Enter a Position and Value, then press Set point to change that sample. Reset curve restores a full minimum-to-maximum ramp for the selected parameter.'),
          item('Enabled mappings', 'Use each row checkbox to include or bypass its curve. X removes the assignment, not the synth control. The selected curve is emphasized; other curves remain visible for comparison.'),
          item('Preview', 'Preview position moves the actual macro and applies all enabled mappings. The selected fader below the graph changes that parameter directly instead; it is also the control used for recording.'),
        ),
      ]),
      details('Recording a fader movement', [
        list(
          'Select an assigned parameter and set Recording seconds from 0.1 to 120 seconds. The default is five seconds. This is separate from Playback cycle timing.',
          'Press Record to arm the selected fader. ARMED means the app is waiting: there is no countdown and no recording until that fader actually changes. Moving another fader does not start the take.',
          'Move the selected editor fader, its original synth fader, or its MIDI control. The first change starts RECORDING and one automatic SuperKnob sweep from minimum to maximum over the chosen duration.',
          'Perform the desired movement while the sweep runs. The app captures that fader into a position-to-value curve; the old curve never drives the recorded fader during the take. Other enabled parameters continue following their own curves.',
          'When the sweep finishes, the new curve replaces the previous curve and the state returns to READY. The knob stays at maximum; recording does not loop or start playback cycling.',
          'Cancel discards an unfinished take and keeps the previous curve. Closing configuration, MIDI Reset, hiding the page, or patch/connection operations also stop unfinished recording. Timing, curve-editing, preset, and selection controls are locked while armed or recording.',
        ),
      ]),
      details('MIDI Learn and temporary fader control', [
        list(
          'Select the separate Controller input, enable MIDI Learn, move the on-screen SuperKnob, then move an absolute-CC controller knob or slider. Turn MIDI Learn off when assignment is complete; the learned mapping remains active and is saved for that controller input.',
          'Outside configuration, that controller moves the whole macro. Pickup prevents jumps: move through the current knob value before the controller takes over. Relative encoders and channel-mode CCs 120 to 127 are not supported.',
          'While configuration is open, a learned SuperKnob controller temporarily controls the selected recording fader instead of moving the macro. The text above the fader identifies its destination. Selector targets are scaled to their 0-to-4 range automatically.',
          'Pickup now follows the selected fader value. After opening configuration, changing the selected parameter, or manually changing that fader, move the controller through the displayed fader value to take control.',
          'You can arm Record and use the learned SuperKnob controller to perform the take. Its movement changes the fader without cancelling or taking over the automatic recording sweep.',
          'Closing configuration restores whole-macro control and resets pickup for the knob position. The stored MIDI assignment is unchanged; clearing or changing it uses the usual MIDI Learn assignment controls.',
        ),
      ]),
      details('Automatic back-and-forth cycling', [
        list(
          'Set Playback cycle timing in configuration or use SuperKnob cycle below the synth. Both views edit the same playback settings, independently of Recording seconds.',
          item('Duration', 'Choose 0.1 to 120 seconds per one-way sweep. A complete minimum-to-maximum-to-minimum trip takes twice that duration.'),
          item('Tempo sync', 'Choose a note length from 1/32 note to eight whole notes per one-way sweep. Cycling follows the shared tempo, including tempo changes during playback.'),
          'Close configuration, then press CYCLE or Start cycle. The macro starts from its current position and repeatedly reverses at the ends. Cycling cannot run while configuration is open.',
          'Move the knob manually or through learned MIDI to stop cycling at the chosen position. Stop cycle also stops it. Restart is always explicit; manual movement never starts an automatic countdown or restart.',
          'Opening configuration, changing playback timing, patch operations, MIDI Reset, connection changes, and hiding the page stop cycling. Running state is not restored after reloading the page.',
        ),
      ]),
      details('C-major audition for live sound checking', [
        list(
          'Check Audition C major in configuration to repeat middle C, E, and G as eighth notes at the shared tempo, with a short gate. Use it while editing, previewing, or recording a curve.',
          'Audition sends notes through the selected synth MIDI output and its receive-channel routing. Connect an audible instrument and unmute MIDI; Web MIDI carries no audio.',
          'This preview is independent of the existing arpeggiator. It does not change its enabled, latch, mode, or rate settings, start Groove Studio, or record audition notes into the looper.',
          'Uncheck the box to stop. Closing configuration, mute, MIDI Reset, patch operations, hiding the page, output/connection changes, or a send failure also stop it. Audition is never saved as enabled or automatically restarted.',
          'If the output is unavailable or a send fails, the checkbox turns off and Messages reports the error. If a hardware note remains held after a failed note-off, restore the MIDI connection and use MIDI Reset.',
        ),
      ]),
      details('Independent macro presets', [
        list(
          'Macro presets contain mappings, their enabled states and curves, Recording seconds, and Playback cycle timing. They are separate from synth patches and saved in this browser.',
          item('Save', 'Updates the selected macro preset. If none is selected, enter a name to create one.'),
          item('Save as', 'Creates an independent named copy of the current definition.'),
          item('Rename and Delete', 'Rename the selected preset or delete it after confirmation. Deleting a preset keeps the current mappings and does not change copies already embedded in synth patches.'),
          'An asterisk marks changes from a selected preset. Custom (unsaved) or Embedded / custom macro identifies a definition not linked to a named preset. Loading another definition asks before replacing edited mappings.',
          'Default - cutoff restores the original Cutoff-only ramp and default timing. Presets and current configuration survive reloads, but recording, cycling, and audition do not resume.',
        ),
      ]),
      details('Synth patches, backups, and storage', [
        list(
          'Enable Include with synth patch to save an independent SuperKnob definition with a sound. The synth-patch save form offers the same option.',
          'Embedded copies travel with patch ZIP exports and cloud patch backups. Editing or deleting a named macro preset never changes an embedded copy, and editing a recalled copy does not update the original macro preset.',
          'Recalling a synth patch stops automation but preserves its saved fader positions; macro curves are not applied until the knob moves. A patch without a SuperKnob definition restores the default Cutoff-only macro. Older definitions without a recording duration use five seconds.',
          'Definitions do not store a running cycle, audition, or an audio performance. Recorded fader motion is saved as its resulting curve. MIDI Learn assignments remain browser preferences, not part of the macro or patch.',
          'Use Import / Export > SuperKnob to back up all saved named macro presets on their own. Everything and Google Drive backups include them too, independently of embedded synth-patch copies. Save the current macro as a preset first if you want to back it up.',
          'Imports merge saved presets: identical matches are skipped; differing matches offer Overwrite, Ignore, or Create new with a unique name. Imports and cloud restores update the preset list without loading a preset or replacing the current unsaved macro configuration.',
          'Cloud replacement saves a recovery snapshot including saved macro presets first. Older backups without a SuperKnob dataset leave presets unchanged; an explicitly empty preset dataset clears the library only on replacement. Current unsaved configuration, knob position, running state, and MIDI Learn assignments remain browser-local and are not backed up.',
        ),
      ]),
      details('Window controls and troubleshooting', [
        list(
          'Configuration is non-modal: move it by dragging the header and keep using the synth alongside it. Changes apply live; closing the window is not an undo command, except that an unfinished recording is discarded.',
          'This Help uses the standard movable, resizable, non-modal help window. Expand the sections you need. Alt+click Help keeps other help windows open; Alt+wheel over a help window changes only its background opacity.',
          'Escape closes the foremost help window first and returns focus to Help without closing configuration or cancelling its armed take. With no help window open, Escape closes configuration.',
          'If Record stays ARMED, make sure the selected fader actually changes and any learned controller has reached pickup. If a parameter does not follow the macro, check that its assignment is enabled.',
          'If a selector changes in steps, that is expected: its destination has only five positions. If there is no audible change, check the selected output, synth MIDI Control, mute state, and Messages; successful sends do not confirm hardware receipt.',
        ),
      ]),
    ],
  },
  patches: {
    title: 'Patch Manager',
    wide: true,
    blocks: [
      paragraph('The Patch Manager saves and organizes Reface CS hardware and Simple Soft Synth patches in this browser. Each patch stores its instrument type and author along with supported controls, name, description, main category, tags, favorites, and optional MP3 previews. System factory patches cannot be edited or deleted; hide them or use Save as to create a User copy.'),
      details('Saving and editing patches', [
        list(
          'Use Save current sound or the save icon beside the patch display to save the current on-screen sound.',
          'For a loaded patch, choose Overwrite to update it or Save as to create a new patch. Save as prepopulates the metadata but does not copy audio attachments.',
          'Enter a name and main category, and optionally add a description and comma-separated tags. Replacing an existing name requires confirmation.',
          'New user patches have Author: User. System factory patches are protected from editing, deletion, and overwrite; Save as creates an independent User copy. Use Hide to remove a factory patch from the default list, or Show hidden factory patches to restore it.',
          'Edit changes a saved patch’s details. Use the favorite star to add or remove it from favorites; the delete icon removes the patch after confirmation.',
          'Snapshots store browser-known sound controls, not performance/system settings or unreported hardware changes.',
          'Optionally include an independent SuperKnob definition. Its mappings, recording duration, and playback cycle timing travel with the patch and its backups; changing a macro preset never changes embedded copies. Loading a patch stops cycling and audition without applying macro curves over its saved sound.',
        ),
      ]),
      details('Finding and organizing sounds', [
        list(
          'Filter by instrument type or author, search by a case-insensitive part of the patch name, enable Favorites, or select category and tag chips.',
          'Multiple selected categories match any category; multiple selected tags match any tag. Name, favorites, category, and tag groups must all match. An empty group adds no restriction.',
          'Clear filters resets the search and all filter selections.',
          'Compact cards show fader outlines. Detailed snapshots adds descriptions and labeled control previews.',
          'Manage categories / tags supports custom labels and deletion of unused categories. Deleting a tag removes it from every patch after confirmation.',
        ),
      ]),
      details('Loading sounds and protecting unsaved changes', [
        list(
          'Load applies the saved sound and switches to its instrument type. Reface CS patches send sound-control CC values to the selected MIDI output; enable MIDI Control on the hardware.',
          'Simple Soft Synth patches render in browser audio without MIDI. Live playback can have noticeable latency; audio timing is scheduled independently of UI updates.',
          'Selecting a card or using Preview plays its first MP3 without loading the sound into the synth. Left/Right moves through the name-sorted filtered cards and previews them, stopping at the ends.',
          'Loading with unsaved sound edits offers Cancel, Discard and load, Overwrite and load when a saved patch is active, or Save as and load.',
          'Settings can skip this warning for patch loads. INIT and synth capture still protect unsaved changes.',
          'Overwriting changed controls on a patch with audio asks whether to keep or delete its audio. Deleting the loaded patch retains its name as an unsaved sound.',
        ),
      ]),
      details('Patch display and INIT', [
        list(
          'The display beside the CS logo names the loaded patch. Its colored dot indicates that browser-known sound controls differ from the saved patch.',
          'The display arrows load the previous or next patch in the current filters without wrapping. Unlike card selection, these arrows recall the sound.',
          'Right-click the patch display, or focus it and press Shift+F10 or the Menu key, to open the current filtered, name-sorted patch list. In mobile landscape, tap or click the display, or press Enter or Space when focused. The loaded patch is highlighted if it matches the filters.',
          'Choose a name to load it with the usual unsaved-change protection. Use Up/Down, Home/End, and Enter to choose by keyboard; Escape or clicking outside dismisses the menu. Long lists scroll; empty libraries or filters show an explanation.',
          'The * button starts an INIT sound by resetting only patch controls, after protecting unsaved edits. Save it as a new patch if you want to keep it.',
          'Reloading the page does not automatically load a patch into the panel or synth.',
        ),
      ]),
      details('MP3 previews and recording', [
        list(
          'Each patch supports up to three MP3 attachments. Add MP3 imports existing files; select another track to preview it. If autoplay is blocked, use the track’s Play preview button.',
          'Settings can hide audio tracks on cards; use the arrow to reveal them until you close them or reload the page.',
          'Drag tracks or use their move buttons to reorder them. Remove unwanted attachments or export them individually.',
          'Record first loads the patch. Hardware recording requires all sound-control CC values to send successfully; soft-synth recording uses the browser audio output.',
          'Connect the synth’s audio output to an audio interface: USB MIDI does not carry audio. Choose an audio input and grant microphone permission over HTTPS or localhost.',
          'Start recording, then stop manually or let it stop at 10 seconds. Preview the locally encoded MP3 before choosing Save MP3, or Discard it. Existing attachments remain unchanged.',
        ),
      ]),
      details('Files, backups, and browser storage', [
        list(
          'A card’s Export downloads a ZIP containing that patch and its audio. Exporting an edited active patch offers the current sound, the saved sound, or cancellation.',
          'Use the top Import / Export button to export or merge a Patch Manager ZIP, or to make optional manual Google Drive backups.',
          'Importing a single patch also recalls it unless replacement of unsaved browser-known sound edits is declined; the optional setting can skip that warning.',
          'Patches and audio live in this browser profile and website address. Clearing site data, browser storage eviction, or private browsing can remove them; keep exported or cloud backups.',
          'Browser-only preferences and MIDI Learn assignments are not included in patches or backups. Cloud backup is manual, not automatic synchronization.',
        ),
      ]),
    ],
  },
  'soft-synth': {
    title: 'Simple Soft Synth',
    blocks: [
      paragraph('SSS is a beginner-friendly browser instrument for exploring subtractive synthesis without owning a reface CS. It is not a recreation of the hardware sound.'),
      heading('Shape your sound'),
      list(
        item('SAW', 'Texture sets the volume of a sawtooth sub-oscillator one octave below the played note.'),
        item('PULSE', 'Texture shifts pulse width from a 50/50 square wave to a 90/10 pulse.'),
        item('Filter', 'Cutoff darkens or brightens the sound; Resonance emphasizes frequencies near the cutoff.'),
        item('ADSR', 'Attack, Decay, Sustain, and Release shape volume over each note.'),
        item('LFO', 'Select AMP, then raise Depth and Speed for rhythmic volume movement. OFF disables it.'),
        item('Pitch bend', 'The range buttons set how many semitones the bend wheel moves in either direction.'),
      ),
      heading('Play and switch instruments'),
      paragraph('Use the on-screen keyboard, computer keyboard, or selected MIDI controller. The arpeggiator and looper can play SSS too. Browser audio sounds only while Simple Soft Synth mode is active; switching back stops its voices and restores hardware MIDI routing.'),
      paragraph('The Patch Manager Instrument filter follows mode changes. System starter patches can be hidden or copied with Save as. Effects are off in SSS; the Reface CS effect settings are preserved.'),
      paragraph('Audio requires browser permission and may have noticeable live-play latency depending on your audio device. Portamento, oscillator MOD, filter-envelope balance, and hardware effects are not supported in SSS.'),
    ],
  },
  cs: {
    title: 'Yamaha reface CS',
    blocks: [
      paragraph('The reface CS is a portable virtual-analog synthesizer with a 37-key mini keyboard, eight-note polyphony, five oscillator types, a low-pass filter, an LFO, shared A/D/S/R envelope controls, and built-in effects. The app’s optional five-octave keyboard view changes only the browser panel, not the hardware keyboard.'),
      details('Detailed Specification', [
        list(
          item('Keyboard and voices', '37 HQ mini keys; eight-note polyphony, with mono/portamento operation available.'),
          item('Oscillators', 'Multi-saw, Pulse, Oscillator Sync, Ring Modulation, and Frequency Modulation (FM).'),
          item('Filter', 'Resonant low-pass filter with Cutoff and Resonance controls.'),
          item('Modulation and envelope', 'LFO with selectable destinations; one A/D/S/R set shared by the amplitude and filter envelope generators, balanced with EG Balance.'),
          item('Effects', 'Distortion, VCM Chorus/Flanger, VCM Phaser, and Delay; one effect selection at a time.'),
          item('Speakers', 'Built-in stereo speakers, 2 W × 2.'),
          'The app Looper is a browser feature, separate from the instrument’s hardware phrase looper.',
        ),
      ]),
      heading('Reference links'),
      list(
        link('reface product site', 'https://uk.yamaha.com/en/musical-instruments/keyboards/products/synthesizers/reface/#d2133634'),
        link('USB MIDI Driver (Windows)', 'https://uk.yamaha.com/en/support/updates/usb-midi-driver-win.html'),
        link('USB MIDI Driver (Mac)', 'https://uk.yamaha.com/en/support/updates/usb-midi-driver-for-mac.html'),
        link('v1.30 updater (Windows)', 'https://uk.yamaha.com/en/support/updates/reface%20updater%20v1-30%20for%20Windows.html'),
        link('v1.30-3 updater (Mac)', 'https://uk.yamaha.com/en/support/updates/reface-csdx-updater-for-mac.html'),
        link('reface Owner’s Manual (PDF)', 'https://uk.yamaha.com/download/files/2360499'),
        link('v1.3 Supplementary Manual (PDF)', 'https://uk.yamaha.com/download/files/2076689'),
        link('Data List (PDF)', 'https://uk.yamaha.com/download/files/2076540'),
        link('Yamaha tutorial videos', 'https://www.youtube.com/watch?v=Os2WYxq1eYM&list=PL3zIryVDCWcWO7TRzDt_uIzEhxP_mEg6y'),
        link('Soundmondo reface CS patches', 'https://soundmondo.yamahasynth.com/voices?reface=CS'),
      ),
    ],
  },
  'pitch-bend': {
    title: 'Pitch Bend',
    blocks: [
      list(
        'Move the control to send pitch bend. Center is neutral; movement bends notes according to the instrument’s configured range and direction.',
        'The control does not spring back automatically.',
        'The − / + range control sets bend magnitude from 0 to 24 semitones and preserves the instrument’s direction.',
        'When connected, the app may need to read the direction or ask you to choose one before sending a change.',
        'Offline changes affect only the local display. A zero range does not encode a direction.',
      ),
    ],
  },
  transpose: {
    title: 'Transpose',
    blocks: [
      list(
        'Transpose shifts app-routed notes and sets the reface’s master transpose for its own keyboard.',
        item('Range', '−12 to +12 semitones. Notes shifted outside the MIDI note range are skipped and reported.'),
        'Changing transpose releases held app-routed notes at their old pitch before subsequent notes use the new setting.',
      ),
    ],
  },
  expression: {
    title: 'Expression',
    blocks: [
      list(
        'Expression sends MIDI CC 11, from 0 to 127; 127 is the default/reset value.',
        'CC 11 affects all sounding notes on the active MIDI channel, including held notes—it is not per-note volume.',
        'Incoming supported CC 11 feedback can update the on-screen value.',
        item('Position-sensitive expression', 'An optional browser setting for mouse/touch playing: a new key press sets expression from the press position and updates the fader.'),
        'On-screen notes otherwise use a fixed velocity of 100.',
      ),
    ],
  },
  octave: {
    title: 'Octave',
    blocks: [
      list(
        'The Octave selector shifts app-routed note numbers by octaves within its available range.',
        'It affects on-screen and forwarded melodic notes and arpeggiator notes; Transpose is a separate semitone control.',
        'Notes outside MIDI’s 0–127 range are skipped rather than wrapped.',
        'Changing octave releases locally held notes where possible.',
      ),
    ],
  },
  mute: {
    title: 'Mute',
    blocks: [
      list(
        'MUTE releases app-routed notes and suppresses new app-routed notes.',
        'It does not change Expression, stop arpeggiator timing, or silence notes played directly on the reface keyboard.',
        'MIDI Reset clears mute state.',
      ),
    ],
  },
  looper: {
    title: 'Looper',
    wide: true,
    blocks: [
      paragraph('This is the browser phrase looper, not the reface’s built-in hardware looper.'),
      list(
        'Records note events from on-screen keys, the selected controller, reface input, or generated arpeggiator notes.',
        'Records notes—not fader movements. Playback uses the current sound and shared tempo.',
        'The reface keyboard continues to play directly.',
      ),
      heading('Record and transport'),
      list(
        'Select CLEAR, then REC to arm. The first note starts recording. The short standby guide uses a MIDI note and the current synth sound; choose CLEAR → PLAY → REC to skip the guide.',
        'Select PLAY to finish the first take and loop it. Select REC to overdub, then PLAY to finish overdubbing. PAUSE resumes; STOP rewinds. CLEAR erases the phrase.',
        'MUTE silences looper playback while its timing continues. MIDI Reset, output loss/change, or hiding the page stops playback; the phrase remains until cleared or the page is reloaded.',
      ),
      heading('Length, meter, and quantization'),
      list(
        'The default 4/4 − 0 + 0 is manual-length recording with quantization off. Toggle 4/4 and 3/4, use − / + to choose a fixed bar length, and choose quantization off or note divisions 1, 2, 4, 8, 16, and 32.',
        'A fixed-length recording starts on the first note, counts down the remaining bars, then wraps into overdubbing until you select PLAY. Selecting PLAY early starts the full-length loop and leaves the remaining space empty.',
        'Quantization moves recorded note starts to the nearest grid point while preserving note duration. Live playing remains immediate, and quantized overdubs are heard on the next loop. Settings changed during a phrase apply to the next new recording.',
        'A phrase is limited to 2,000 notes and 1,200 beats (up to 10 minutes at 120 BPM).',
      ),
      heading('Saving and files'),
      list(
        'Use the icons beside LOOPER to import/export loop files, load saved loops, or save a named loop in this browser.',
        'The temporary phrase is not automatically saved.',
        item('Native loop JSON', 'Preserves exact length.'),
        item('MIDI import', 'Supports beat-based Type 0 and synchronized Type 1 files, not Type 2 or SMPTE timing; non-note events may be ignored.'),
        item('Pure MIDI export', 'Rounds timing and omits app-specific loop-length metadata, so trailing silence may not be restored.'),
      ),
    ],
  },
  tempo: {
    title: 'Tempo',
    blocks: [
      list(
        'Tempo sets the shared beat rate for the browser looper, arpeggiator, and Groove Studio.',
        item('Range', '40 to 240 BPM.'),
        'Changing it updates the shared tempo; when connected, the app also sends the reface’s tempo using SysEx, which requires the browser’s additional SysEx permission.',
        'The arpeggiator tempo resets to 120 BPM when enabled or when its display is double-clicked.',
      ),
    ],
  },
  lfo: {
    title: 'LFO',
    blocks: [
      paragraph('The low-frequency oscillator adds cyclic modulation.'),
      list(
        item('Assign', 'Selects what it modulates.'),
        item('Depth', 'Controls modulation strength.'),
        item('Speed', 'Controls modulation rate.'),
      ),
      paragraph('These are relative controls, not calibrated readouts.'),
    ],
  },
  'lfo-assign': {
    title: 'LFO — Assign',
    blocks: [
      paragraph('Assign chooses the LFO destination:'),
      list(
        item('OFF', 'No LFO modulation.'),
        item('AMP', 'Changes oscillator volume. In Simple Soft Synth, this is the only available destination besides OFF.'),
        item('FILTER', 'Modulates filter cutoff.'),
        item('PITCH', 'Modulates oscillator pitch.'),
        item('OSC', 'Modulates a parameter that depends on oscillator type.'),
      ),
      heading('OSC destination by oscillator'),
      list(
        item('Multi-saw', 'Modulates pitch, but not its sub-oscillator.'),
        item('Pulse', 'Modulates pulse width.'),
        item('Sync / Ring', 'Modulates OSC2 pitch for Sync/Ring.'),
        item('FM', 'Modulates FM amount.'),
      ),
    ],
  },
  'lfo-depth': {
    title: 'LFO — Depth',
    blocks: [paragraph('Depth controls how strongly the assigned destination is modulated. The displayed value is a control value, not a calibrated modulation amount.')],
  },
  'lfo-speed': {
    title: 'LFO — Speed',
    blocks: [paragraph('Speed controls the LFO rate. The app does not display a calibrated frequency in Hz.')],
  },
  portamento: {
    title: 'Portamento',
    blocks: [
      paragraph('Portamento controls how notes glide between pitches.'),
      list(
        item('POLY', 'Allows polyphonic notes without portamento.'),
        item('MONO', 'Selects monophonic playing with portamento time.'),
      ),
      paragraph('The app does not display exact glide times in milliseconds.'),
    ],
  },
  osc: {
    title: 'OSC — Oscillator',
    blocks: [
      list(
        item('SAW', 'Multi-saw.'),
        item('PULSE', 'Pulse.'),
        item('SYNC', 'Oscillator Sync.'),
        item('RING', 'Ring Modulation.'),
        item('FM', 'Frequency Modulation.'),
      ),
      paragraph('Texture and MOD change the selected oscillator’s character in different ways; choose a type and adjust its controls to explore the sound.'),
    ],
  },
  'osc-type': {
    title: 'OSC — Type',
    blocks: [
      paragraph('Select one of the reface CS oscillator types:'),
      list(
        item('SAW — Multi-saw', 'Layers sawtooth waveforms for a classic, fuller synthesizer sound.'),
        item('PULSE', 'Uses square waves; a second square wave can be layered at a different pitch.'),
        item('SYNC — Oscillator Sync', 'Uses two synchronized oscillators. Changing OSC2 pitch and tone produces distinctive harmonics.'),
        item('RING — Ring Modulation', 'Combines two oscillator signals and can produce metallic, inharmonic sounds.'),
        item('FM — Frequency Modulation', 'OSC2 modulates OSC1 frequency, producing complex harmonics.'),
      ),
    ],
  },
  'osc-texture': {
    title: 'OSC — Texture',
    blocks: [
      paragraph('Texture changes according to the selected oscillator:'),
      list(
        item('Multi-saw', 'Adds an octave-lower sub-oscillator; in Simple Soft Synth, Texture sets its volume.'),
        item('Pulse', 'Changes the pitch of the second square wave on Reface CS; Simple Soft Synth shifts pulse width from 50/50 to 90/10.'),
        item('Sync', 'Changes OSC2 pitch and tone.'),
        item('Ring', 'Changes OSC1 pitch.'),
        item('FM', 'Sets the modulation amount.'),
      ),
    ],
  },
  'osc-mod': {
    title: 'OSC — MOD',
    blocks: [
      paragraph('MOD changes according to the selected oscillator:'),
      list(
        item('Multi-saw', 'Layers multiple sawtooth waveforms for a thicker sound.'),
        item('Pulse', 'Changes pulse width.'),
        item('Sync', 'Sets the amount of OSC2 pitch change.'),
        item('Ring', 'Changes OSC2 pitch.'),
        item('FM', 'Changes the pitch of the modulator oscillator (OSC2).'),
      ),
    ],
  },
  filter: {
    title: 'Filter — Cutoff and Resonance',
    blocks: filterDescription,
  },
  'filter-cutoff': {
    title: 'Filter — Cutoff',
    blocks: filterDescription,
  },
  'filter-resonance': {
    title: 'Filter — Resonance',
    blocks: filterDescription,
  },
  eg: {
    title: 'EG / ADSR',
    blocks: [
      paragraph('The same Attack, Decay, Sustain, and Release controls shape both the amplitude envelope (AEG, loudness over time) and filter envelope (FEG, filter movement over time). The two ADSR displays are views of these shared controls, not independent envelope settings.'),
      list(
        item('Attack', 'Time for the envelope to rise after a note starts.'),
        item('Decay', 'Time to move from the initial peak toward the sustain level.'),
        item('Sustain', 'Level held while the note remains pressed.'),
        item('Release', 'Time for the envelope to fall after the note is released.'),
        item('EG Balance', 'Blends AEG and FEG influence. At one end AEG is maximized and FEG has no effect; at the other FEG is maximized; the middle gives them equal influence.'),
      ),
      paragraph('Exact envelope times, curve shapes, and a numerical balance law are not specified here. The displays are schematic. Zero AEG influence is not the same as muting the note: the note gate remains.'),
    ],
  },
  effect: {
    title: 'Effect',
    blocks: [effectType, effectDepth, heading('Rate'), effectRate],
  },
  'effect-type': {
    title: 'Effect — Type',
    blocks: [effectType],
  },
  'effect-depth': {
    title: 'Effect — Depth',
    blocks: [effectDepth],
  },
  'effect-rate': {
    title: 'Effect — Rate',
    blocks: [
      paragraph('Rate has a different meaning for each effect:'),
      effectRate,
      paragraph('The effect display is schematic, not a simulation of the hardware algorithm.'),
    ],
  },
  groove: {
    title: 'Groove Studio',
    wide: true,
    blocks: [
      list(
        'Groove Studio is a sixteenth-note step sequencer that can use the internal drum synth, external MIDI devices, or both.',
        'The internal engine is an 808-inspired drum machine with synthesized sounds, not samples or a faithful circuit emulation.',
        'Drum sounds are separate from the reface CS sound engine.',
      ),
      details('Getting started', [
        list(
          'Choose Internal under Drum output.',
          'Click Enable audio, or press the green Play button to enable it automatically.',
          'Click steps in the Kick, Snare, and hi-hat lanes to build a rhythm.',
          'Set Tempo, time signature, and pattern length.',
          'Press Play to loop the pattern. The white square stops playback.',
        ),
      ]),
      details('Steps, bars, and velocity', [
        list(
          item('Step grid', 'Each step is a sixteenth note: 16 steps per bar in 4/4, or 12 in 3/4.'),
          item('Bars', 'Choose a pattern length from 1 to 16 bars. Scroll horizontally to reach later bars.'),
          item('Add a hit', 'Click an empty step to set level 5.'),
          item('Change strength', 'Repeated clicks cycle 5, 4, 3, 2, 1, 2, 3, 4, 5...'),
          item('Velocity', 'Levels 1 to 5 correspond to MIDI velocities 25, 51, 76, 102, and 127, before lane Level is applied.'),
          item('Remove a hit', 'Right-click it, or focus it and press Delete or Backspace.'),
          'Shortening a pattern preserves the hidden bars. Switching to 3/4 preserves steps 13 to 16 without playing them; returning to 4/4 restores them.',
          'Tempo and time signature are shared with the looper. Tempo is also shared with the arpeggiator.',
        ),
      ]),
      details('Instruments and lanes', [
        list(
          'Start with empty Kick, Snare, Closed hi-hat, and Open hi-hat lanes.',
          'Use Add instrument and Add lane to add Clap, Low/Mid/High toms, Shaker, Crash, or Ride.',
          'Click an instrument’s name to preview it through the selected drum output.',
          item('S - Solo', 'When any lane is soloed, only soloed lanes play.'),
          item('M - Mute', 'Silences the lane without erasing its steps. Mute takes priority over Solo.'),
          'Solo and Mute affect pattern playback, controller-triggered hits, and lane previews.',
          'Closed hi-hats cut off ringing open hi-hats.',
          'Open the lane options (...) for controls and actions. Removing a lane removes its sequence from the current pattern.',
        ),
      ]),
      details('Shaping internal sounds', [
        list(
          item('Level, 0 to 100%', 'Adjusts lane loudness. It also scales external MIDI velocity; zero produces no external hit.'),
          item('Tune, -24 to +24 semitones', 'Shifts the internal instrument’s pitch.'),
          item('Decay, 20 to 2,000 ms', 'Adjusts how quickly the internal sound fades.'),
          item('Tone, 0 to 100%', 'Changes the instrument’s character; its effect depends on the voice.'),
          item('Kick Tone', 'Changes the initial pitch sweep and attack noise.'),
          item('Tom Tone', 'Changes the noise component.'),
          item('Snare Tone', 'Changes the balance and filtering of its pitched and noisy components.'),
          item('Clap, hats, shaker, and cymbal Tone', 'Changes noise filtering and brightness.'),
          item('Master', 'Controls overall internal drum volume, not the external MIDI instrument.'),
        ),
      ]),
      details('Saving and loading tones', [
        list(
          'Save an instrument’s Level, Tune, Decay, and Tone as a named variation.',
          'The Save icon appears when those settings differ from the loaded tone or instrument defaults.',
          'Load opens that instrument’s tone library, with name filtering, favorites, sorting, and previews.',
          'Tone-library previews always use internal audio and ignore lane Solo/Mute.',
          'Loading over modified settings offers save/discard choices.',
          'Patterns keep their own sound-setting snapshots; editing or deleting a library tone does not silently change other patterns.',
          'Import/export individual tones as JSON files.',
          'In External MIDI mode, internal tone controls and tone-library actions are hidden. Their settings remain intact.',
        ),
      ]),
      details('Copying and clearing bars', [
        list(
          item('Copy', 'Copies the bar in soloed lanes, or all lanes if none are soloed.'),
          item('Paste', 'Replaces steps for the copied instruments. Missing lanes are added with default sound settings.'),
          item('Clear', 'Immediately clears visible steps in soloed lanes, or all lanes if none are soloed.'),
          'Copy/paste transfers steps, not instrument tone settings.',
          'When switching meters, only steps visible in both meters are pasted; hidden steps remain unchanged.',
          'The copied bar stays available until the page is reloaded.',
        ),
      ]),
      details('Patterns and backups', [
        list(
          'Patterns, steps, lane settings, and Solo/Mute states save automatically in this browser.',
          item('New pattern', 'Creates an empty pattern with the four starting lanes.'),
          item('Save pattern as', 'Duplicates the current pattern.'),
          'Select a pattern to switch to it; Rename and Delete manage saved patterns.',
          'Pattern switching changes subsequent scheduled hits; it is not a song-arrangement system.',
          'Tempo and meter are shared transport settings, not stored separately for each pattern.',
          item('Export pattern - JSON', 'Preserves the pattern and its lane settings.'),
          item('Export pattern - MIDI', 'Exports one track per lane on channel 10, including muted/non-soloed lanes. It omits internal sound settings, lane Level, Solo/Mute, and hidden steps.'),
          item('Import pattern', 'Loads supported pattern JSON with playback stopped.'),
          'Use the main Import / Export tools for Groove Studio backups, including the tone library. Browser storage can be cleared; keep downloaded backups.',
        ),
      ]),
      details('Playback and looper linking', [
        list(
          item('Play', 'Repeats the current pattern.'),
          item('Space', 'Toggles drum playback when you are not typing or using a dialog or another control’s keyboard shortcut.'),
          item('Start and Stop together with looper', 'Links starts and looper Pause/Clear behavior. An empty looper still needs a recorded or imported phrase.'),
          item('Explicit Stop', 'Always stops both drums and looper and requests MIDI Reset, even when linking is disabled.'),
          'A player joining an already-running transport starts on the next available bar.',
          'For drum-aligned loop recording, choose a fixed looper bar length and play the first note on the intended downbeat.',
          item('Start on keypress', 'Starts stopped drums on a melodic note from the on-screen keyboard or a selected MIDI input. Releasing the note does not stop them.'),
          'Channel-10 controller drums and generated looper/arpeggiator notes do not trigger Start on keypress.',
          'Collapsing Groove Studio does not stop playback. Hiding the page or using MIDI Reset does.',
        ),
      ]),
      details('Internal audio and external MIDI', [
        list(
          item('Internal', 'Plays browser-generated drums.'),
          item('External MIDI', 'Sends drum notes to the independent output/channel selected in MIDI settings.'),
          item('Internal + MIDI', 'Plays both paths.'),
          'Pattern hits, lane previews, and controller-triggered drums follow this routing.',
          'External MIDI uses editable instrument-to-note mappings. Its channel defaults to 10.',
          item('Octave', 'Shifts external notes by -3 to +3 octaves without changing internal audio or base mappings. Out-of-range notes are skipped with a warning.'),
          item('Reverb', 'Sends CC91 to the selected external channel; the receiving instrument determines its effect.'),
          'Tune, Decay, Tone, and internal Master do not change external sounds.',
          'External-only playback still requires Web Audio for the shared clock.',
          'Controller input on MIDI channel 10 triggers drums rather than melodic reface notes. These hits are not recorded by the melodic looper.',
        ),
      ]),
      details('External sound selection', [
        list(
          'MIDI settings provides CS2x kit/Performance presets and custom bank/program values.',
          'Selecting a kit chooses channel 10; selecting a Performance chooses channel 1. Match the instrument’s mode and receive channels yourself.',
          'Preset selection sends bank/program changes. Custom values require Apply kit / Performance.',
          'These messages can replace the device’s current sound. Sounds and reverb are not automatically reapplied on reconnect.',
          'For standalone software, select a virtual MIDI cable as both Groove Studio’s output and the software instrument’s input.',
          'Routing preferences and MIDI mappings remain browser-local and are excluded from exports and cloud backups.',
        ),
      ]),
      details('Audio output and timing', [
        list(
          item('Audio output', 'Chooses the internal drum playback device where the browser supports it; it does not reroute the reface’s physical audio.'),
          item('Choose audio output / Refresh outputs', 'Requests device selection or refreshes the available list.'),
          item('Looper MIDI offset, -600 to +600 ms', 'Negative sends playback MIDI earlier; positive sends it later.'),
          'The offset also affects sequenced external drums in Internal + MIDI, but not External MIDI-only mode.',
          'Live keyboard playing, controller drum hits, and lane previews remain immediate.',
          item('Calibrate MIDI offset', 'Stops normal playback and plays a 100 BPM test kick. Play notes on the selected reface input; Done applies only the latest measured delay positively.'),
          'Calibration includes your playing timing and MIDI input delay; it does not measure the instrument’s audio-output latency. Cancel leaves the previous offset unchanged.',
          'Fine-tune by ear using a short synth sound and your actual monitoring setup.',
          'Prefer wired audio. Bluetooth adds delay; a fixed offset cannot eliminate timing jitter. Web Audio does not provide direct ASIO access.',
        ),
      ]),
    ],
  },
  arpeggiator: {
    title: 'Arpeggiator',
    blocks: [
      paragraph('The browser arpeggiator replaces on-screen and selected-controller notes with a timed pattern while ON is active; notes played directly on the reface remain direct. Source-note velocities are preserved. Turn it off to resume notes that are still held.'),
      list(
        item('Latch', 'On by default. Keeps a pattern playing after keys are released; once all keys are released, the first new key press replaces the latched pattern.'),
        item('Chord', 'Expands white keys into C-major diatonic triads and black keys into the diatonic seventh chord rooted at the white key to their left. Notes above MIDI 127 are omitted.'),
        item('Tempo', 'Shared with the looper and Groove Studio, from 40 to 240 BPM. It resets to 120 BPM when the arpeggiator is enabled or its display is double-clicked. Use − / + for 1 BPM, Shift-click for 10 BPM, or the wheel over the display (Alt for 10 BPM).'),
        item('Rate', 'Choices are 1/2, 1/4, 1/8, 1/16 (default), and 1/32. The note gate is 50% of each step.'),
        item('Mode', 'Up, Down, Up/Down, Down/Up, First/Last/Middle, and Random. Up/down modes do not repeat turning points. First/Last/Middle alternates from the outside toward the center. Random avoids repeating a note more than three times in a row; with one note held, it pauses for a step after three repeats.'),
      ),
      list(
        'Click Rate or Mode to cycle options; right-click, Arrow Down, or Shift+F10 opens the full menu.',
        'Notes and Chord readouts describe currently held on-screen, reface-input, and selected-controller notes—not released latched notes or generated chord tones.',
        'MIDI Reset, output changes, and hiding the page stop the pattern and clear held/latch state.',
      ),
    ],
  },
};
