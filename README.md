# refaceCS
Manager for the Yamaha refaceCS Synthesizer 

## Goals
- visual representation of the synth controls
- Basic midi sequencer
- while playing send midi cc to control the synth
- Patch management
  - The synth itself does not have patch storage and recall
  - Patches should have name, description, category, tags, favorite, up to 3 assoziated mp3 files, image (or live generated) of state of faders
  - search/filter by  name, description, category, tags, favorite
- Settings
- Live play

## Research / Ideas to be discussed with AI before coding
- Platform / technology: Web (webmidi, vue.js), but where to store? node.js or python backend. Software should run locally (windows, ideally platform independed)
- visual representation of the synth should be an svg (or multiple svg, like the faders)
- mp3 files are locally stored
- research: read manual
- What settings are available, can they be synced and set?
- how can patches stored and aplied
