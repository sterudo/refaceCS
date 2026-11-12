# refaceCS
Manager for the Yamaha refaceCS Synthesizer 

## Development

Requires Node.js 20.19+ or 22.12+ (or a newer supported release) and npm.

```powershell
npm install
npm run dev
```

Open the localhost URL printed by Vite, including `/static/reface/`.
The current page is a minimal vanilla JavaScript, HTML, and CSS shell; MIDI and patch features are not implemented yet.

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
