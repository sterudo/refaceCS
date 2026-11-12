# Yamaha reface CS MIDI reference

This is a working implementation reference for the **reface CS only**. Do not substitute values from the DX, CP, or YC sections of the combined reface Data List.

## Source and confidence

Research snapshot: 2026-11-12.

The source is Yamaha's *reface Data List*, CS section, especially pages 2 (MIDI Data Format), 4 (MIDI Data Table), and 5 (MIDI Implementation Chart). Yamaha's [reface support/downloads page](https://usa.yamaha.com/musical-instruments/keyboards/products/synthesizers/reface/support.html) is the authoritative document index. The following page links are a readable transcription of the Data List:

- [Data List, page 2: CS MIDI Data Format](https://www.manualsdir.com/manuals/848895/yamaha-reface-yc.html?page=2)
- [Data List, page 4: CS MIDI Data Table](https://www.manualsdir.com/manuals/848895/yamaha-reface-yc.html?page=4)
- [Data List, page 5: CS MIDI Implementation Chart](https://www.manualsdir.com/manuals/848895/yamaha-reface-yc.html?page=5)

The Yamaha support page was reachable during research, but its direct PDF URL returned 404. Treat the transcription as a research aid and verify against a Yamaha-hosted Data List PDF before shipping message-generation code.

## General MIDI behavior

- The Data List specifies MIDI 1.0.
- Receive channel is configurable from channels 1–16; the MIDI implementation chart lists channel 1 as the default. The instrument also supports Omni receive.
- Note On, Note Off, Pitch Bend, and supported Control Change messages are received. The CS MIDI implementation chart marks Program Change unsupported; patch recall must therefore use parameter values, not program changes.
- The CS implementation chart lists All Sound Off (CC 120) and All Notes Off (CC 123) as recognized. The app's MIDI Reset sends both on all 16 channels; a successful browser send does not confirm the instrument responded.
- The synth transmits Expression (CC 11) and Sustain (CC 64) in the documented cases. When MIDI Control is on, the panel voice parameters use their assigned CC numbers, as detailed below.
- MIDI Control can be turned on or off. Panel-control CC transmission and recognition are documented when this setting is on.
- Timing Clock received over MIDI IN or USB-MIDI IN switches the instrument to external synchronization. If no clock is received for three seconds, it returns to its internal clock. Start and Stop are listed; Continue is also listed as received.
- Active Sensing is transmitted every 200 ms. After it has received Active Sensing, the instrument clears its MIDI receive buffer and forcibly stops currently playing sounds if no status or data arrives for approximately 350 ms.

## Control Change map

The parameter-control map below is for MIDI Control mode. For discrete controls, each row shows the representative value and the accepted value interval stated in the Data List.

| Parameter | CC | Values |
|---|---:|---|
| LFO Assign | 78 | Off: 0 (0–25); Amp: 32 (26–51); Filter: 64 (52–76); Pitch: 95 (77–102); Oscillator: 127 (103–127) |
| LFO Depth | 77 | 0–127 |
| LFO Speed | 76 | 0–127 |
| Portamento | 20 | 0: Poly; 1–127: Mono with portamento time |
| Oscillator Type | 80 | Multi-saw: 0 (0–25); Pulse: 32 (26–51); Oscillator Sync: 64 (52–76); Ring Modulation: 95 (77–102); Frequency Modulation: 127 (103–127) |
| Oscillator Texture | 81 | 0–127 |
| Oscillator Modulation | 82 | 0–127 |
| Filter Cutoff | 74 | 0–127 |
| Filter Resonance | 71 | 0–127 |
| EG FEG–AEG Balance | 83 | 0–127 |
| EG Attack | 73 | 0–127 |
| EG Decay | 75 | 0–127 |
| EG Sustain | 79 | 0–127 |
| EG Release | 72 | 0–127 |
| Effect Type | 17 | Distortion: 0 (0–25); Chorus/Flanger: 32 (26–51); Phaser: 64 (52–76); Delay: 95 (77–102); Off/Thru: 127 (103–127) |
| Effect Depth | 18 | 0–127 |
| Effect Rate | 19 | 0–127 |

The discrete midpoint values above are the values named by the Data List; the intervals show how incoming values are interpreted. Test hardware behavior at interval boundaries before finalizing UI encoding.

## SysEx message formats

The reface CS Data List documents Universal Non-Realtime Identity messages and Yamaha parameter-change, bulk-dump, dump-request, and parameter-request messages. The CS Model ID is `03H`; the Yamaha group address is `7F 1C`.

### Universal Identity

- Identity Request (receive only): `F0 7E 0n 06 01 F7`
- Identity Reply (transmit only): `F0 7E 7F 06 02 43 00 41 51 06 00 00 00 7F F7`
- The manual says the request's device number is treated as Omni by the instrument.

### Parameter Change

```text
F0 43 1n 7F 1C 03 aa bb cc dd... F7
```

`1n` is the Yamaha device-number status byte; `aa bb cc` is the three-byte address; `dd...` contains the parameter data. The manual says parameters with a data size of two or more use the corresponding number of data bytes. Use the address and size from the CS MIDI Data Table.

### Parameter Request

```text
F0 43 3n 7F 1C 03 aa bb cc F7
```

This requests the parameter at the specified address. The manual provides the format; verify the actual response and USB-MIDI behavior with the instrument.

### Bulk Dump

```text
F0 43 0n 7F 1C bb bb 03 aa bb cc 00 data... checksum F7
```

The two `bb` bytes are the byte count; the following `aa bb cc` is the start address. The Data List defines the byte count as the size from Model ID through data, up to but not including the checksum. The checksum is chosen so that the sum of Model ID, start address, data, and checksum is zero modulo 128 (the lower seven bits sum to zero).

### Dump Request

```text
F0 43 2n 7F 1C 03 aa bb cc F7
```

The Data List specifies requesting a bulk dump by address and says to use the corresponding Bulk Header address for a Tone Generator dump. Do not hard-code a request or assume its reply layout without validating it against the manual and hardware.

## Parameter address tables

Addresses below are three-byte hexadecimal addresses. For compactness, each row lists the low address under the documented System or Tone Generator base address.

### System parameters

Base address: `00 00 00`; documented table size: 32.

| Low address | Size | Parameter | Values / notes |
|---:|---:|---|---|
| `00` | 1 | MIDI transmit channel | `00`–`0F`: channels 1–16; `7F`: Off |
| `01` | 1 | MIDI receive channel | `00`–`0F`: channels 1–16; `10`: All |
| `02` | 4 | Master Tune | -102.4 to +102.3 cents; value is split across four nibbles |
| `06` | 1 | Local Control | `00`: Off; `01`: On |
| `07` | 1 | Master Transpose | `34`–`4C`: -12 to +12 semitones |
| `08` | 2 | Tempo | 30–300 BPM, split across two 7-bit data bytes |
| `0B` | 1 | Sustain Pedal Select | `00`/`01`: FC3 / FC4/5 |
| `0C` | 1 | Auto Power-Off | `00`: Off; `01`: On |
| `0D` | 1 | Speaker Output | `00`: Off; `01`: On |
| `0E` | 1 | MIDI Control | `00`: Off; `01`: On |
| `0F` | 1 | Pitch Bend Range | `28`–`58`: -24 to +24 semitones; factory default +12 semitones (user-confirmed) |
| `14` | 1 | Foot Volume/Sustain switch | `00`/`01`: Foot Volume / Sustain |

Addresses not listed above are marked reserved in the Data List.

### Tone Generator parameters

Base address: `30 00 00`; documented table size: 22.

| Low address | Size | Parameter | Values / notes |
|---:|---:|---|---|
| `00` | 1 | Volume | 0–127; documented as MIDI-set only |
| `01` | 1 | Reserved | — |
| `02` | 1 | LFO Assign | 0–4: Off, Amp, Filter, Pitch, Oscillator |
| `03` | 1 | LFO Depth | 0–127 |
| `04` | 1 | LFO Speed | 0–127 |
| `05` | 1 | Portamento | 0: Poly; 1–127: Mono with portamento time |
| `06` | 1 | Oscillator Type | 0–4: Multi-saw, Pulse, Oscillator Sync, Ring Modulation, Frequency Modulation |
| `07` | 1 | Oscillator Texture | 0–127 |
| `08` | 1 | Oscillator Modulation | 0–127 |
| `09` | 1 | Filter Cutoff Frequency | 0–127 |
| `0A` | 1 | Filter Resonance | 0–127 |
| `0B` | 1 | EG Balance | 0–127; AEG max to FEG max |
| `0C` | 1 | EG Attack | 0–127 |
| `0D` | 1 | EG Decay | 0–127 |
| `0E` | 1 | EG Sustain | 0–127 |
| `0F` | 1 | EG Release | 0–127 |
| `10` | 1 | Effect Type | 0–4: Distortion, Chorus/Flanger, Phaser, Delay, Off/Thru |
| `11` | 1 | Effect Depth | 0–127 |
| `12` | 1 | Effect Rate | 0–127; effect-dependent: distortion tone, modulation rate, or delay time |
| `13` | 3 | Reserved | — |

## Bulk dump blocks

The Data List (page 4) gives the following blocks:

| Block | Byte count (decimal / hex) | Top address |
|---|---:|---|
| System Common | 36 / `24` | `00 00 00` |
| Tone Generator Bulk Header | 4 / `04` | `0E 0F 00` |
| Tone Generator Common | 26 / `1A` | `30 00 00` |
| Tone Generator Bulk Footer | 4 / `04` | `0F 0F 00` |

The manual says to designate the corresponding Bulk Header address to request a Tone Generator bulk dump. These block descriptions are not a substitute for validating a complete dump/restore exchange.

## Visualization research: Filter, EG, LFO, and Effect

The owner's manual provides qualitative behavior, not a calibrated model for rendering response curves. The following findings were checked against readable transcriptions of its CS pages:

- [Printed page 11: LFO](https://www.manualslib.com/manual/959024/Yamaha-Reface-Cs.html?page=17)
- [Printed page 12: oscillator-specific LFO destinations](https://www.manualslib.com/manual/959024/Yamaha-Reface-Cs.html?page=18)
- [Printed page 13: Filter, EG, and Effect](https://www.manualslib.com/manual/959024/Yamaha-Reface-Cs.html?page=19)

Filter is a 24 dB/octave low-pass filter. Cutoff changes its cutoff frequency; Resonance emphasizes the resonant character. These pages do not establish the conversion from raw control values to Hz or the exact resonance response.

The same A/D/S/R controls adjust both FEG and AEG: attack time, decay time, sustain level, and release time. EG Balance maximizes AEG at the bottom, where FEG has no effect; maximizes FEG at the top; and gives the two equal influence in the middle. Separate displays should therefore share ADSR settings while distinguishing their influence. The text does not establish an exact numerical interpolation law or state that AEG becomes silent at the FEG endpoint. Do not equate absence of amplitude-envelope modulation with muting the sound. Absolute envelope times and curvature remain unverified.

LFO Assign selects no modulation, oscillator volume, filter cutoff, oscillator pitch, or an oscillator-specific parameter. Depth changes modulation strength; Speed changes rate. At OSC, the destination depends on oscillator type: pitch for Multi-saw (excluding its sub-oscillator), pulse width for Pulse, OSC2 pitch for Sync/Ring, and FM amount for FM. The reviewed text does not specify a waveform or raw-value-to-Hz conversion.

Effect Depth controls effect strength. Rate controls distortion tone for DIST, modulation rate for CHO/FLA and PHASER, or delay time for DELAY. OFF passes the sound through unchanged. An effect preview must change its interpretation with Type; a single generic rate waveform would misrepresent distortion and delay.

Any initial graphs should be explicitly schematic, not measured audio, exact hardware responses, or verified Hz/millisecond readouts. Keep these modeling assumptions separate from the MIDI encodings above.
