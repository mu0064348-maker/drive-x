import * as THREE from 'three';

// DRIVE X: Traffic system
const trafficCars = [];

const trafficColors = [
  0xf04444, // Red
  0xf5f5f5, // White
  0x3478db, // Blue
  0xffc247  // Yellow
];

export function createTraffic(scene) {
  const car = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.6, 3),
    new THREE.MeshStandardMaterial({ color: 0xf04444 })
  );

  body.position.y = 0.65;
  car.add(body);

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 0.55, 1.4),
    new THREE.MeshStandardMaterial({ color: 0xcceeff })
  );

  cabin.position.set(0, 1.2, -0.2);
  car.add(cabin);

  car.position.set(3, 0, -20);
  scene.add(car);
  trafficCars.push(car);
}

export function updateTraffic(dt, speed, distance) {
  // We'll add movement in a later step.
}

export function resetTraffic() {
  // We'll add restart handling in a later step.
}
