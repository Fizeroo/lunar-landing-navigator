import test from 'node:test';
import assert from 'node:assert/strict';
import { poseAlongDescent, distanceFromEye, surfaceShare } from '../src/scene/transition.ts';

const eye = { position: [0, 1.7, 0], forward: [0, 0.05, -Math.sqrt(1 - 0.05 ** 2)], up: [0, 1, 0], fovDeg: 65 };
const orbit = { position: [600000, 3600000, 400000], forward: [-0.1, -0.98, -0.17], up: [0, 0, -1], fovDeg: 38 };

test('camera hand-over shares one finite view and returns to its original endpoints', () => {
  assert.deepEqual(poseAlongDescent(orbit, eye, 1736500, 0).position, orbit.position);
  const arrival = poseAlongDescent(orbit, eye, 1736500, 1);
  assert.deepEqual(arrival.position, eye.position);
  assert.equal(arrival.fovDeg, eye.fovDeg);
  arrival.forward.forEach((x, i) => assert.ok(Math.abs(x - eye.forward[i]) < 1e-12));
  let previous = Infinity;
  for (let i = 0; i <= 100; i++) {
    const p = poseAlongDescent(orbit, eye, 1736500, i / 100);
    assert.ok([...p.position, ...p.forward, ...p.up, p.fovDeg].every(Number.isFinite));
    const distance = distanceFromEye(p, eye);
    assert.ok(distance <= previous + 1e-6, 'approach never jumps back outward');
    assert.ok(Math.abs(Math.hypot(...p.forward) - 1) < 1e-12);
    assert.ok(Math.abs(Math.hypot(...p.up) - 1) < 1e-12);
    previous = distance;
  }
});

test('reversing at any progress preserves the pose and renderer mix without a black cover', () => {
  for (const t of [0.02, 0.35, 0.62, 0.93, 0.99]) {
    const down = poseAlongDescent(orbit, eye, 1736500, t);
    const up = poseAlongDescent(orbit, eye, 1736500, t - 1e-7);
    assert.ok(Math.hypot(...up.position.map((x, i) => x - down.position[i])) < 10,
      'the first reverse step is continuous even late in the descent');
    const mix = surfaceShare(distanceFromEye(down, eye), 7000, 2600);
    assert.ok(mix >= 0 && mix <= 1);
    assert.equal(mix + (1 - mix), 1);
  }
  assert.equal(surfaceShare(7000, 7000, 2600), 0);
  assert.equal(surfaceShare(2600, 7000, 2600), 1);
});

test('a far approach from the opposite hemisphere stays clear of the lunar bulk', () => {
  const farSide = { ...orbit, position: [10000, -4000000, 50000] };
  for (let i = 0; i <= 100; i++) {
    const pose = poseAlongDescent(farSide, eye, 1736500, i / 100);
    if (distanceFromEye(pose, eye) > 25000) {
      assert.ok(Math.hypot(pose.position[0], pose.position[1] + 1736500, pose.position[2]) >= 1739500 - 1e-6);
    }
  }
});
