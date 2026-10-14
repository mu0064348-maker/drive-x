import * as THREE from 'three';
import { createTraffic, updateTraffic, resetTraffic } from './traffic.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game-canvas');
const ui = {
  menu: $('menu-screen'), hud: $('hud'), pause: $('pause-screen'), finish: $('finish-screen'), loading: $('loading-screen'), error: $('error-screen'),
  status: $('game-status'), menuBest: $('menu-best'), distance: $('distance-readout'), checkpoint: $('checkpoint-readout'), speed: $('speed-readout'), speedFill: $('speed-fill'),
  toast: $('checkpoint-toast'), offroad: $('offroad-warning'), errorMessage: $('error-message')
};

const SETTINGS = { roadWidth: 12, laneLimit: 4.35, targetDistance: 2400, checkpointEvery: 600, maxSpeed: 58, acceleration: 24, braking: 42, drag: 5.4, tileLength: 40, tileCount: 9 };
const state = {
  mode: 'menu', speed: 0, distance: 0, lateral: 0, steer: 0, topSpeed: 0, checkpoints: 0,
  cameraMode: 0, sound: true, muted: false, offroad: false, toastTimer: 0, offroadTimer: 0,
  held: { left: false, right: false, accelerate: false, brake: false }, bestDistance: 0,
  lastFrame: 0, elapsed: 0, collisionCooldown: 0
};

let scene, camera, renderer, car, carBody, wheels = [], world, roadTiles = [], scenery = [], obstacles = [], checkpointMarkers = [], clock;
let audioContext = null, engineOsc = null, engineGain = null, audioReady = false;

function loadBest() { try { state.bestDistance = Math.max(0, Number(localStorage.getItem('driveXBestDistance') || 0)); } catch (_) { state.bestDistance = 0; } ui.menuBest.textContent = `${Math.floor(state.bestDistance)} m`; }
function saveBest() { if (state.distance > state.bestDistance) { state.bestDistance = Math.floor(state.distance); try { localStorage.setItem('driveXBestDistance', String(state.bestDistance)); } catch (_) {} } ui.menuBest.textContent = `${Math.floor(state.bestDistance)} m`; }

function init() {
  try {
    if (!window.WebGLRenderingContext) throw new Error('This browser does not appear to support WebGL. Try Chrome and make sure hardware acceleration is enabled.');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.65));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = false;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x91c9e8);
    scene.fog = new THREE.Fog(0x91c9e8, 65, 250);
    camera = new THREE.PerspectiveCamera(66, window.innerWidth / window.innerHeight, 0.1, 500);
    camera.position.set(0, 5.1, 10.5);
    clock = new THREE.Clock();
    buildWorld(); buildCar(); buildRoad(); buildScenery(); buildObstacles();
    scene.add(new THREE.HemisphereLight(0xd9f3ff, 0x51623b, 2.0));
    const sun = new THREE.DirectionalLight(0xffedcf, 2.7); sun.position.set(-30, 60, 25); scene.add(sun);
    addSkyDecor();
    window.addEventListener('resize', onResize, { passive: true });
    bindControls();
    loadBest();
    $('start-btn').addEventListener('click', startGame);
    $('pause-btn').addEventListener('click', pauseGame);
    $('resume-btn').addEventListener('click', resumeGame);
    $('restart-btn').addEventListener('click', startGame);
    $('again-btn').addEventListener('click', startGame);
    $('exit-btn').addEventListener('click', returnToMenu);
    $('garage-btn').addEventListener('click', returnToMenu);
    $('camera-btn').addEventListener('click', () => { state.cameraMode = (state.cameraMode + 1) % 2; $('camera-btn').innerHTML = `CAM <b>0${state.cameraMode + 1}</b>`; });
    $('sound-btn').addEventListener('click', toggleSound);
    $('brand-home').addEventListener('click', (e) => { e.preventDefault(); if (state.mode === 'driving') pauseGame(); else returnToMenu(); });
    $('retry-btn').addEventListener('click', () => { ui.error.classList.add('hidden'); initRetry(); });
    window.addEventListener('keydown', onKeyDown); window.addEventListener('keyup', onKeyUp); window.addEventListener('blur', clearHeld);
    document.addEventListener('visibilitychange', () => { if (document.hidden && state.mode === 'driving') pauseGame(); });
    $('loading-screen').classList.add('hidden');
    animate();
  } catch (err) {
    console.error(err); ui.loading.classList.add('hidden'); ui.error.classList.remove('hidden'); ui.errorMessage.textContent = err?.message || 'The 3D engine failed to start.';
  }
}

function initRetry() { location.reload(); }
function mat(color, roughness = 0.85, metalness = 0) { return new THREE.MeshStandardMaterial({ color, roughness, metalness }); }
function addBox(parent, w, h, d, material, x, y, z, cast = false) { const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material); mesh.position.set(x, y, z); mesh.castShadow = cast; mesh.receiveShadow = true; parent.add(mesh); return mesh; }
function buildWorld() {
  world = new THREE.Group(); scene.add(world);
  const grass = mat(0x6f985b, 1), meadow = mat(0x88ad6a, 1);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), grass); ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.17, -360); world.add(ground);
  const farGround = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), meadow); farGround.rotation.x = -Math.PI / 2; farGround.position.set(0, -0.19, -1050); world.add(farGround);
  // Soft rolling fields give the road a more expansive countryside silhouette.
  const hillMats = [mat(0x739766), mat(0x819f70), mat(0x9bb47b)];
  for (let i = 0; i < 14; i++) {
    const side = i % 2 ? 1 : -1;
    const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), hillMats[i % hillMats.length]);
    hill.scale.set(24 + Math.random() * 28, 7 + Math.random() * 10, 34 + Math.random() * 34);
    hill.position.set(side * (42 + Math.random() * 60), -2.8, -55 - i * 36);
    hill.userData.kind = 'hill'; hill.userData.side = side; world.add(hill); scenery.push(hill);
  }
}
function buildCar() {
  car = new THREE.Group(); scene.add(car);
  const paint = new THREE.MeshStandardMaterial({ color: 0x13d6c0, metalness: 0.55, roughness: 0.27 });
  const dark = mat(0x101923, 0.55, 0.2), glass = new THREE.MeshStandardMaterial({ color: 0x17374b, metalness: 0.25, roughness: 0.16 });
  carBody = new THREE.Group(); car.add(carBody);
  addBox(carBody, 1.9, 0.52, 3.65, paint, 0, 0.75, 0, true);
  addBox(carBody, 1.56, 0.48, 1.68, glass, 0, 1.18, -0.18, true);
  addBox(carBody, 1.64, 0.12, 0.62, paint, 0, 1.08, -1.38, true);
  addBox(carBody, 1.72, 0.10, 0.55, paint, 0, 0.92, 1.48, true);
  addBox(carBody, 0.46, 0.10, 0.18, mat(0xeafaff, 0.2), -0.57, 0.78, -1.85);
  addBox(carBody, 0.46, 0.10, 0.18, mat(0xeafaff, 0.2), 0.57, 0.78, -1.85);
  addBox(carBody, 0.44, 0.12, 0.12, mat(0xff4d3d, 0.25), -0.57, 0.78, 1.85);
  addBox(carBody, 0.44, 0.12, 0.12, mat(0xff4d3d, 0.25), 0.57, 0.78, 1.85);
  const wheelMat = mat(0x15191d, 0.9), hubMat = mat(0x9aaab5, 0.35, 0.8);
  for (const x of [-0.99, 0.99]) for (const z of [-1.12, 1.15]) {
    const wheel = new THREE.Group(); wheel.position.set(x, 0.43, z); car.add(wheel);
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.22, 16), wheelMat); tire.rotation.z = Math.PI / 2; wheel.add(tire);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.235, 12), hubMat); hub.rotation.z = Math.PI / 2; wheel.add(hub);
    wheels.push({ group: wheel, front: z < 0 });
  }
  car.position.set(0, 0, 0);
}
function buildRoad() {
  const roadMat = mat(0x303943, 0.98), shoulderMat = mat(0xd2d0bc), lineMat = new THREE.MeshBasicMaterial({ color: 0xf8f2d9 });
  const vergeMat = mat(0xb8c79a), reflectorMat = mat(0xf4f4e9, 0.35, 0.1);
  const tileLength = SETTINGS.tileLength;
  for (let i = 0; i < SETTINGS.tileCount; i++) {
    const group = new THREE.Group(); group.position.z = 25 - i * tileLength; world.add(group);
    const road = new THREE.Mesh(new THREE.PlaneGeometry(SETTINGS.roadWidth, tileLength), roadMat); road.rotation.x = -Math.PI / 2; road.position.y = -0.04; group.add(road);
    for (const side of [-1, 1]) {
      const verge = new THREE.Mesh(new THREE.PlaneGeometry(3.8, tileLength), vergeMat); verge.rotation.x = -Math.PI / 2; verge.position.set(side * 8.0, -0.105, 0); group.add(verge);
      const shoulder = new THREE.Mesh(new THREE.PlaneGeometry(1.25, tileLength), shoulderMat); shoulder.rotation.x = -Math.PI / 2; shoulder.position.set(side * (SETTINGS.roadWidth / 2 + 0.62), -0.025, 0); group.add(shoulder);
      const edge = new THREE.Mesh(new THREE.PlaneGeometry(0.13, tileLength), lineMat); edge.rotation.x = -Math.PI / 2; edge.position.set(side * (SETTINGS.roadWidth / 2 - 0.32), -0.012, 0); group.add(edge);
      // Small reflective road studs on the outer edge.
      for (let j = 0; j < 4; j++) {
        const stud = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.12), reflectorMat);
        stud.position.set(side * (SETTINGS.roadWidth / 2 - 0.52), 0.015, -tileLength / 2 + 5 + j * 10); group.add(stud);
      }
    }
    for (const x of [-2, 2]) { const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.10, 4.4), lineMat); dash.rotation.x = -Math.PI / 2; dash.position.set(x, -0.011, 0); group.add(dash); }
    // Subtle center reflectors improve the sense of speed without overloading the phone.
    const centerStud = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.045, 0.16), new THREE.MeshBasicMaterial({ color: 0xe7dba7 }));
    for (let j = 0; j < 4; j++) { const stud = centerStud.clone(); stud.position.set(0, 0.018, -tileLength / 2 + 5 + j * 10); group.add(stud); }
    roadTiles.push(group);
  }
}
function makeTree() {
  const group = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 1.25, 6), mat(0x705039)); trunk.position.y = 0.62; group.add(trunk);
  const greens = [0x2f6345, 0x3d7548, 0x4b824e, 0x5c8b51];
  const leaves = new THREE.Mesh(new THREE.ConeGeometry(0.95, 2.6, 7), mat(greens[Math.floor(Math.random() * greens.length)])); leaves.position.y = 2.15; group.add(leaves);
  const crown = new THREE.Mesh(new THREE.ConeGeometry(0.67, 1.75, 7), mat(greens[Math.floor(Math.random() * greens.length)])); crown.position.y = 2.78; group.add(crown);
  return group;
}
function makeRoundTree() {
  const group = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.2, 1.4, 6), mat(0x77533a)); trunk.position.y = 0.7; group.add(trunk);
  const leafMat = mat([0x47784a, 0x5e8b50, 0x6f9655][Math.floor(Math.random() * 3)]);
  for (const [x,y,z,r] of [[0,1.9,0,0.95],[-0.38,2.25,0.1,0.72],[0.35,2.3,-0.1,0.76]]) { const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), leafMat); crown.position.set(x,y,z); group.add(crown); }
  return group;
}
function makeRock() {
  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.7 + Math.random() * 0.65, 0), mat([0x858b83,0x9b9d91,0x747d78][Math.floor(Math.random()*3)]));
  rock.scale.y = 0.55 + Math.random() * 0.5; rock.rotation.set(Math.random(), Math.random(), Math.random()); return rock;
}
function makeLamp() {
  const g = new THREE.Group(), poleMat = mat(0x4b5c61, 0.45, 0.35), lampMat = new THREE.MeshStandardMaterial({ color: 0xffe8ae, emissive: 0x6e5124, roughness: 0.45 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07,0.1,4.5,6), poleMat); pole.position.y = 2.25; g.add(pole);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(1.0,0.08,0.08), poleMat); arm.position.set(-0.42,4.35,0); g.add(arm);
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.42,0.16,0.28), lampMat); lamp.position.set(-0.82,4.25,0); g.add(lamp); return g;
}
function makeRoadSign(textColor = 0xffffff) {
  const g = new THREE.Group(), postMat = mat(0x626f70), boardMat = mat(0x28715d,0.7,0.05);
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.12,2.5,0.12),postMat); post.position.y=1.25; g.add(post);
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.75,0.9,0.14),boardMat); board.position.set(0,2.3,0); g.add(board);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.25,0.08,0.16),new THREE.MeshBasicMaterial({color:textColor})); stripe.position.set(0,2.3,0); g.add(stripe); return g;
}
function makeFence() {
  const g = new THREE.Group(), wood = mat(0xc5b58a);
  for (const y of [0.55,1.0]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(4.2,0.12,0.12),wood); rail.position.y=y; g.add(rail); }
  for (const x of [-1.9,0,1.9]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.14,1.15,0.14),wood); post.position.set(x,0.57,0); g.add(post); }
  return g;
}
function buildScenery() {
  // Mixed tree lines, rocks, fences, lamps and signs make each stretch feel different.
  for (let i = 0; i < 46; i++) {
    const side = i % 2 ? 1 : -1, z = -18 - Math.random() * 390;
    const tree = Math.random() < 0.36 ? makeRoundTree() : makeTree();
    tree.userData.kind = 'tree'; tree.userData.side = side; tree.position.set(side * (10 + Math.random() * 23), -0.08, z); tree.scale.setScalar(0.65 + Math.random() * 1.1); world.add(tree); scenery.push(tree);
  }
  for (let i = 0; i < 20; i++) {
    const side = i % 2 ? 1 : -1, rock = makeRock(); rock.userData.kind = 'rock'; rock.userData.side = side;
    rock.position.set(side * (8.8 + Math.random() * 11), -0.02, -20 - Math.random() * 370); world.add(rock); scenery.push(rock);
  }
  for (let i = 0; i < 12; i++) {
    const side = i % 2 ? 1 : -1, fence = makeFence(); fence.userData.kind = 'fence'; fence.userData.side = side;
    fence.position.set(side * (11 + Math.random() * 3), -0.08, -22 - i * 29); world.add(fence); scenery.push(fence);
  }
  for (let i = 0; i < 8; i++) {
    const side = i % 2 ? 1 : -1, lamp = makeLamp(); lamp.userData.kind = 'lamp'; lamp.userData.side = side;
    lamp.position.set(side * 9.3, -0.08, -45 - i * 45); world.add(lamp); scenery.push(lamp);
  }
  for (let i = 0; i < 6; i++) {
    const side = i % 2 ? 1 : -1, sign = makeRoadSign(); sign.userData.kind = 'sign'; sign.userData.side = side;
    sign.position.set(side * 10.5, -0.08, -75 - i * 62); world.add(sign); scenery.push(sign);
  }
  const mountainMats = [mat(0x819fa0), mat(0x91aeb0), mat(0x9eb8b0)];
  for (let i = 0; i < 15; i++) {
    const side = i % 2 ? 1 : -1;
    const mountain = new THREE.Mesh(new THREE.ConeGeometry(22 + Math.random() * 30, 24 + Math.random() * 35, 6), mountainMats[i % mountainMats.length]);
    mountain.position.set(side * (65 + Math.random() * 95), 8, -100 - i * 38); mountain.rotation.y = Math.random() * Math.PI;
    mountain.userData.kind = 'mountain'; mountain.userData.side = side; world.add(mountain); scenery.push(mountain);
  }
}
function makeBarrier() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.8, 1.3), mat(0xf36b43)); body.position.y = 0.4; g.add(body);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.13, 1.32), mat(0xf8eee0)); stripe.position.y = 0.55; g.add(stripe);
  return g;
}
function buildObstacles() {
  for (let i = 0; i < 14; i++) {
    const obstacle = makeBarrier(); obstacle.userData.lane = [-3.1, 0, 3.1][i % 3]; obstacle.position.set(obstacle.userData.lane, 0, -35 - i * 28); world.add(obstacle); obstacles.push(obstacle);
  }
  const gateMat = new THREE.MeshStandardMaterial({ color: 0x68f2e0, emissive: 0x125c58, metalness: 0.3, roughness: 0.3 });
  for (let i = 1; i <= 3; i++) {
    const gate = new THREE.Group(); gate.position.z = -SETTINGS.checkpointEvery * i; world.add(gate);
    const left = new THREE.Mesh(new THREE.BoxGeometry(0.22, 4.5, 0.22), gateMat); left.position.set(-5.4, 2.25, 0); gate.add(left);
    const right = left.clone(); right.position.x = 5.4; gate.add(right);
    const top = new THREE.Mesh(new THREE.BoxGeometry(11, 0.22, 0.22), gateMat); top.position.y = 4.5; gate.add(top);
    checkpointMarkers.push(gate);
  }
}
function addSkyDecor() {
  const sun = new THREE.Mesh(new THREE.SphereGeometry(5, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff1c2 })); sun.position.set(-45, 55, -180); scene.add(sun);
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xf5fbff, roughness: 1 });
  for (let i = 0; i < 12; i++) {
    const cloud = new THREE.Group();
    for (let j = 0; j < 4; j++) { const puff = new THREE.Mesh(new THREE.SphereGeometry(2 + Math.random() * 2, 8, 6), cloudMat); puff.position.set(j * 2.7, Math.random() * 1.3, 0); cloud.add(puff); }
    cloud.position.set((Math.random() - 0.5) * 150, 28 + Math.random() * 22, -50 - Math.random() * 260); cloud.scale.setScalar(0.8 + Math.random() * 1.5); scene.add(cloud);
  }
}
function roadCenterAt(distance) { return Math.sin(distance * 0.00145) * 3.0 + Math.sin(distance * 0.00043 + 1.3) * 2.0; }
function resetWorld() {
  state.speed = 0; state.distance = 0; state.lateral = 0; state.steer = 0; state.topSpeed = 0; state.checkpoints = 0; state.elapsed = 0; state.collisionCooldown = 0;
  car.position.set(0, 0, 0); car.rotation.set(0, 0, 0); carBody.rotation.set(0, 0, 0);
  roadTiles.forEach((tile, i) => { tile.position.z = 25 - i * SETTINGS.tileLength; tile.position.x = 0; });
  scenery.forEach((obj) => { const kind = obj.userData.kind; if (kind === 'tree' || kind === 'rock' || kind === 'fence' || kind === 'lamp' || kind === 'sign') { obj.position.z = -18 - Math.random() * 390; obj.position.x = obj.userData.side * (kind === 'tree' ? 10 + Math.random() * 23 : kind === 'rock' ? 8.8 + Math.random() * 11 : kind === 'fence' ? 12 : kind === 'lamp' ? 9.3 : 10.5); } else if (kind === 'hill' || kind === 'mountain') { obj.position.z = kind === 'hill' ? -55 - Math.random() * 500 : -100 - Math.random() * 520; } });
  obstacles.forEach((obj, i) => { obj.position.z = -35 - i * 28; obj.userData.lane = [-3.1, 0, 3.1][i % 3]; obj.position.x = obj.userData.lane; obj.visible = true; });
  checkpointMarkers.forEach((gate, i) => { gate.position.z = -SETTINGS.checkpointEvery * (i + 1); gate.visible = true; });
  ui.distance.innerHTML = '0000<span>m</span>'; ui.checkpoint.innerHTML = '01<span>/03</span>'; ui.speed.textContent = '000'; ui.speedFill.style.width = '0%';
}
function startGame() {
  resetWorld(); clearHeld(); state.mode = 'driving'; ui.menu.classList.add('hidden'); ui.pause.classList.add('hidden'); ui.finish.classList.add('hidden'); ui.hud.classList.remove('hidden'); ui.status.textContent = 'DRIVING'; clock.getDelta(); initAudio();
}
function pauseGame() { if (state.mode !== 'driving') return; state.mode = 'paused'; clearHeld(); ui.pause.classList.remove('hidden'); ui.status.textContent = 'PAUSED'; updateEngineAudio(); }
function resumeGame() { if (state.mode !== 'paused') return; state.mode = 'driving'; ui.pause.classList.add('hidden'); ui.status.textContent = 'DRIVING'; clock.getDelta(); }
function returnToMenu() { state.mode = 'menu'; clearHeld(); ui.menu.classList.remove('hidden'); ui.hud.classList.add('hidden'); ui.pause.classList.add('hidden'); ui.finish.classList.add('hidden'); ui.status.textContent = 'READY'; saveBest(); }
function finishGame() { state.mode = 'finished'; clearHeld(); saveBest(); ui.hud.classList.add('hidden'); ui.finish.classList.remove('hidden'); ui.status.textContent = 'RUN COMPLETE'; $('result-distance').textContent = `${Math.floor(state.distance)} m`; $('result-speed').textContent = `${Math.round(state.topSpeed * 3.6)} km/h`; $('result-checkpoints').textContent = `${state.checkpoints} / 3`; $('finish-title').innerHTML = state.checkpoints === 3 ? 'ROAD<br><em>MASTER.</em>' : 'RUN<br><em>COMPLETE.</em>'; $('finish-message').textContent = state.checkpoints === 3 ? 'All checkpoints cleared. Clean driving.' : 'Trial distance reached. Try again to clear every checkpoint.'; updateEngineAudio(); }

function bindControls() {
  document.querySelectorAll('[data-control]').forEach((button) => {
    const key = button.dataset.control;
    const down = (e) => { e.preventDefault(); state.held[key] = true; button.classList.add('active'); try { button.setPointerCapture(e.pointerId); } catch (_) {} };
    const up = (e) => { e.preventDefault(); state.held[key] = false; button.classList.remove('active'); };
    button.addEventListener('pointerdown', down); button.addEventListener('pointerup', up); button.addEventListener('pointercancel', up); button.addEventListener('lostpointercapture', up); button.addEventListener('contextmenu', (e) => e.preventDefault());
  });
}
function clearHeld() { Object.keys(state.held).forEach(k => state.held[k] = false); document.querySelectorAll('[data-control]').forEach(b => b.classList.remove('active')); }
function onKeyDown(e) {
  const key = e.key.toLowerCase();
  if (['arrowleft','arrowright','arrowup','arrowdown',' ','a','d','w','s'].includes(key)) e.preventDefault();
  if (key === 'arrowleft' || key === 'a') state.held.left = true;
  if (key === 'arrowright' || key === 'd') state.held.right = true;
  if (key === 'arrowup' || key === 'w') state.held.accelerate = true;
  if (key === 'arrowdown' || key === 's' || key === ' ') state.held.brake = true;
  if (key === 'escape' || key === 'p') { if (state.mode === 'driving') pauseGame(); else if (state.mode === 'paused') resumeGame(); }
  if (key === 'c') { state.cameraMode = (state.cameraMode + 1) % 2; $('camera-btn').innerHTML = `CAM <b>0${state.cameraMode + 1}</b>`; }
}
function onKeyUp(e) { const key = e.key.toLowerCase(); if (key === 'arrowleft' || key === 'a') state.held.left = false; if (key === 'arrowright' || key === 'd') state.held.right = false; if (key === 'arrowup' || key === 'w') state.held.accelerate = false; if (key === 'arrowdown' || key === 's' || key === ' ') state.held.brake = false; }
function onResize() { if (!renderer || !camera) return; camera.aspect = window.innerWidth / window.innerHeight; camera.fov = window.innerWidth < 650 ? 70 : 64; camera.updateProjectionMatrix(); renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.65)); renderer.setSize(window.innerWidth, window.innerHeight); }
function flash(el, duration = 1.5) { el.classList.add('show'); if (el === ui.toast) state.toastTimer = duration; else state.offroadTimer = duration; }
function checkCollisions() {
  if (state.collisionCooldown > 0) return;
  for (const obstacle of obstacles) {
    if (!obstacle.visible) continue;
    const dz = Math.abs(obstacle.position.z);
    if (dz < 2.3 && Math.abs(obstacle.position.x - car.position.x) < 1.65) {
      state.speed *= 0.34; state.collisionCooldown = 0.85; obstacle.visible = false;
      if (state.sound) playImpact(); break;
    }
  }
}
function updateDriving(dt) {
  state.elapsed += dt;
  state.collisionCooldown = Math.max(0, state.collisionCooldown - dt);
  const accel = state.held.accelerate, brake = state.held.brake;
  if (accel) state.speed += SETTINGS.acceleration * dt;
  else state.speed -= SETTINGS.drag * dt;
  if (brake) state.speed -= SETTINGS.braking * dt;
  state.speed = THREE.MathUtils.clamp(state.speed, 0, SETTINGS.maxSpeed);
  const steerInput = (state.held.right ? 1 : 0) - (state.held.left ? 1 : 0);
  state.steer = THREE.MathUtils.damp(state.steer, steerInput, 8, dt);
  const speedFactor = 0.18 + state.speed / SETTINGS.maxSpeed;
  state.lateral += state.steer * speedFactor * 7.4 * dt;
  state.lateral = THREE.MathUtils.clamp(state.lateral, -8.5, 8.5);
  state.distance += state.speed * dt;
  state.topSpeed = Math.max(state.topSpeed, state.speed);
  const center = roadCenterAt(state.distance);
  state.offroad = Math.abs(state.lateral) > SETTINGS.laneLimit;
  if (state.offroad) { state.speed = Math.max(0, state.speed - 15 * dt); if (state.offroadTimer <= 0) flash(ui.offroad, 0.8); }
  ui.offroad.classList.toggle('show', state.offroad && state.offroadTimer > 0.2);
  car.position.x = center + state.lateral;
  car.position.y = Math.sin(state.elapsed * 11) * 0.018 * (state.speed / SETTINGS.maxSpeed);
  car.rotation.y = -state.steer * 0.12 - state.lateral * 0.008;
  carBody.rotation.z = -state.steer * 0.055;
  wheels.forEach(({ group, front }) => { group.rotation.x += state.speed * dt * 0.75; if (front) group.rotation.y = -state.steer * 0.38; });
  updateWorld(dt);
  checkCollisions();
  const cp = Math.min(3, Math.floor(state.distance / SETTINGS.checkpointEvery));
  if (cp > state.checkpoints) { state.checkpoints = cp; ui.checkpoint.innerHTML = `${String(Math.min(3, cp + 1)).padStart(2,'0')}<span>/03</span>`; flash(ui.toast, 1.7); }
  ui.distance.innerHTML = `${String(Math.floor(state.distance)).padStart(4,'0')}<span>m</span>`;
  ui.speed.textContent = String(Math.round(state.speed * 3.6)).padStart(3, '0');
  ui.speedFill.style.width = `${(state.speed / SETTINGS.maxSpeed) * 100}%`;
  updateCamera(dt); updateEngineAudio();
  if (state.distance >= SETTINGS.targetDistance) finishGame();
}
function updateWorld(dt) {
  const travel = state.speed * dt;
  for (const tile of roadTiles) {
    tile.position.z += travel;
    if (tile.position.z > 45) tile.position.z -= SETTINGS.tileCount * SETTINGS.tileLength;
    const worldDistance = state.distance - tile.position.z;
    tile.position.x = roadCenterAt(worldDistance);
  }
  for (const obj of scenery) {
    const kind = obj.userData.kind;
    const scroll = kind === 'mountain' ? 0.10 : kind === 'hill' ? 0.22 : 1;
    obj.position.z += travel * scroll;
    if (obj.position.z > (kind === 'mountain' ? 35 : kind === 'hill' ? 32 : 28)) {
      obj.position.z = kind === 'mountain' ? -500 - Math.random() * 450 : kind === 'hill' ? -360 - Math.random() * 400 : -300 - Math.random() * 180;
      if (kind === 'tree') obj.position.x = obj.userData.side * (10 + Math.random() * 23);
      else if (kind === 'rock') obj.position.x = obj.userData.side * (8.8 + Math.random() * 11);
      else if (kind === 'fence') obj.position.x = obj.userData.side * 12;
      else if (kind === 'lamp') obj.position.x = obj.userData.side * 9.3;
      else if (kind === 'sign') obj.position.x = obj.userData.side * 10.5;
      else if (kind === 'hill') obj.position.x = obj.userData.side * (42 + Math.random() * 60);
      else if (kind === 'mountain') obj.position.x = obj.userData.side * (65 + Math.random() * 95);
    }
  }
  for (const obstacle of obstacles) {
    obstacle.position.z += travel;
    if (obstacle.position.z > 8) { obstacle.position.z -= 14 * 28; obstacle.visible = true; obstacle.userData.lane = [-3.1, 0, 3.1][Math.floor(Math.random() * 3)]; }
    obstacle.position.x = roadCenterAt(state.distance - obstacle.position.z) + obstacle.userData.lane;
  }
  checkpointMarkers.forEach((gate, i) => { gate.position.z = (i + 1) * -SETTINGS.checkpointEvery + state.distance; gate.position.x = roadCenterAt(state.distance - gate.position.z); gate.visible = state.distance < (i + 1) * SETTINGS.checkpointEvery + 5; });
  // Scenery recycles along the roadside; distant hills and mountains use parallax for depth.
}
function updateCamera(dt) {
  const center = roadCenterAt(state.distance);
  const close = state.cameraMode === 0;
  const target = new THREE.Vector3(car.position.x + (close ? -state.steer * 0.45 : 0), close ? 4.5 : 8.3, close ? 8.5 : 15.5);
  camera.position.lerp(target, 1 - Math.exp(-3.5 * dt));
  const look = new THREE.Vector3(center + state.lateral * 0.2, 0.9, -13);
  camera.lookAt(look);
  camera.fov = THREE.MathUtils.damp(camera.fov, 64 + state.speed * 0.12, 2, dt); camera.updateProjectionMatrix();
}
function updateMenuScene(dt) {
  const t = clock.elapsedTime;
  car.position.x = Math.sin(t * 0.25) * 0.2; car.rotation.y = Math.sin(t * 0.25) * 0.02;
  camera.position.lerp(new THREE.Vector3(0, 5.4, 11.5), 1 - Math.exp(-1.8 * dt)); camera.lookAt(0, 0.6, -5);
  roadTiles.forEach((tile, i) => { tile.position.z = 25 - i * 40; tile.position.x = Math.sin(t * 0.1 + i * 0.2) * 0.4; });
}
function animate() {
  requestAnimationFrame(animate);
  if (!renderer || !scene) return;
  const dt = Math.min(clock.getDelta(), 0.04);
  if (state.toastTimer > 0) { state.toastTimer -= dt; if (state.toastTimer <= 0) ui.toast.classList.remove('show'); }
  if (state.offroadTimer > 0) { state.offroadTimer -= dt; if (state.offroadTimer <= 0 && !state.offroad) ui.offroad.classList.remove('show'); }
  if (state.mode === 'driving') updateDriving(dt); else if (state.mode === 'menu') updateMenuScene(dt);
  renderer.render(scene, camera);
}

function initAudio() {
  if (!state.sound || audioReady) { updateEngineAudio(); return; }
  try {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    audioContext = new AC(); engineOsc = audioContext.createOscillator(); engineGain = audioContext.createGain();
    const filter = audioContext.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 500;
    engineOsc.type = 'sawtooth'; engineOsc.frequency.value = 45; engineGain.gain.value = 0.0001;
    engineOsc.connect(filter); filter.connect(engineGain); engineGain.connect(audioContext.destination); engineOsc.start(); audioReady = true;
    audioContext.resume().catch(() => {}); updateEngineAudio();
  } catch (_) { audioReady = false; }
}
function updateEngineAudio() { if (!audioReady || !audioContext) return; const running = state.mode === 'driving' && state.sound; const now = audioContext.currentTime; engineGain.gain.setTargetAtTime(running ? 0.025 + state.speed / SETTINGS.maxSpeed * 0.035 : 0.0001, now, 0.08); engineOsc.frequency.setTargetAtTime(42 + state.speed * 2.2, now, 0.08); }
function playImpact() { if (!audioContext || !state.sound) return; try { const osc = audioContext.createOscillator(), gain = audioContext.createGain(); osc.type = 'triangle'; osc.frequency.setValueAtTime(120, audioContext.currentTime); osc.frequency.exponentialRampToValueAtTime(45, audioContext.currentTime + 0.18); gain.gain.setValueAtTime(0.09, audioContext.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.2); osc.connect(gain); gain.connect(audioContext.destination); osc.start(); osc.stop(audioContext.currentTime + 0.21); } catch (_) {} }
function toggleSound() { state.sound = !state.sound; $('sound-btn').textContent = state.sound ? '♫' : '×'; $('sound-btn').setAttribute('aria-label', state.sound ? 'Mute sound' : 'Enable sound'); if (state.sound) initAudio(); updateEngineAudio(); }

loadBest();
init();
