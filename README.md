# DRIVE X — 3D Road Trial

A mobile-friendly, third-person 3D driving challenge built with HTML, CSS, JavaScript and Three.js. Designed to run as a static site on GitHub Pages and to be editable in Acode on Android.

## Files

- `index.html` — page structure, HUD and Three.js import map.
- `style.css` — responsive UI, mobile touch controls and overlays.
- `game.js` — 3D world, driving model, collision handling, checkpoints, camera, sound and saved best distance.

## Controls

### Android / touch
- Hold **GAS** to accelerate.
- Hold **BRAKE** to slow down.
- Hold **← / →** to steer.
- **CAM** switches between two chase camera distances.
- **Ⅱ PAUSE** pauses the run.

### Keyboard
- `W` / `↑`: accelerate
- `S` / `↓` / `Space`: brake
- `A` / `←`: steer left
- `D` / `→`: steer right
- `C`: switch camera
- `P` / `Esc`: pause or resume

## Run locally in Acode

1. Create a folder named `drive-x`.
2. Put `index.html`, `style.css`, `game.js`, and this README inside it.
3. Open `index.html` through Acode's preview/local server if available. If a direct file preview blocks JavaScript modules, publish to GitHub Pages and test the HTTPS page instead.
4. Internet access is required to load Three.js and the Google Fonts used by this version.

## Publish to GitHub Pages

1. On GitHub, create a new public repository named `drive-x` (or another name you prefer).
2. Upload `index.html`, `style.css`, `game.js`, and `README.md` to the repository root — not inside an extra nested folder.
3. Open **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Choose branch `main` and folder `/ (root)`, then save.
6. Wait for the Pages deployment to finish. Your URL will be `https://YOUR-USERNAME.github.io/drive-x/` if the repository is named `drive-x`.

If you use an existing repository, upload the three application files to its root. Be careful not to overwrite unrelated projects.

## Notes / known limits

- The game uses a lightweight arcade driving model, not a full vehicle physics simulation.
- 3D geometry is generated in code, so no model downloads are needed.
- Three.js is loaded from jsDelivr; the page needs internet access to start. If the CDN is unavailable, the error panel will explain that the engine did not start.
- Browser performance varies by device. If a phone gets hot or drops frames, reduce the browser's open tabs and test in Chrome.
- Best distance is saved with `localStorage` on the same browser/device. It is not a global leaderboard.
