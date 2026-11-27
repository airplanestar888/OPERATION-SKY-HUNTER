// Operation: Sky Hunter — checkpoint rings.
// Glowing neon rings the drone flies through. Each ring carries a floating
// distance label; the active ring pulses cyan, passed rings turn green,
// upcoming rings stay dim amber. Passing is a 3D proximity check against
// the ring centre, scored by how close to dead-centre the drone was.

import { clamp } from './random.js';

const THREE = window.THREE;

function makeLabelSprite(text) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(26, 6.5, 1);
  sprite.userData.canvas = c;
  sprite.userData.texture = tex;
  sprite.userData.text = text;
  return sprite;
}

function drawLabel(sprite, text, color) {
  const c = sprite.userData.canvas;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 64);
  g.fillStyle = 'rgba(4, 18, 12, 0.72)';
  g.beginPath();
  g.roundRect(6, 8, 244, 48, 10);
  g.fill();
  g.strokeStyle = color;
  g.lineWidth = 2;
  g.stroke();
  g.fillStyle = color;
  g.font = 'bold 24px Arial';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 34);
  sprite.userData.texture.needsUpdate = true;
}

export function createRings(scene, defs, radius) {
  const rings = [];
  defs.forEach((def, i) => {
    const group = new THREE.Group();
    // Torus ring, facing along the approach direction.
    const torus = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.55, 12, 40),
      new THREE.MeshStandardMaterial({
        color: 0x0a2a22, emissive: 0x18c8a8, emissiveIntensity: 1.4, roughness: 0.4, metalness: 0.2,
      }),
    );
    torus.castShadow = false;
    group.add(torus);
    // Outer glow halo (additive, cheap).
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(radius + 0.7, 0.28, 8, 40),
      new THREE.MeshBasicMaterial({ color: 0x18e8c8, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    group.add(halo);
    // Direction chevrons inside the ring: three small cones pointing through.
    for (let k = -1; k <= 1; k++) {
      const chev = new THREE.Mesh(
        new THREE.ConeGeometry(0.9, 2.2, 4),
        new THREE.MeshBasicMaterial({ color: 0x9ff5e4 }),
      );
      chev.rotation.x = Math.PI / 2;
      chev.position.set(k * 2.6, 0, 0);
      group.add(chev);
    }
    // Floating label above the ring.
    const label = makeLabelSprite(`RING ${i + 1}`);
    label.position.set(0, radius + 7, 0);
    group.add(label);

    group.position.set(def.x, def.y, def.z);
    // Face the ring toward the previous point (or the spawn for ring 0).
    const from = def.from || { x: def.x, y: def.y, z: def.z + 100 };
    group.lookAt(from.x, from.y, from.z);
    scene.add(group);
    rings.push({
      index: i,
      def,
      group,
      torus,
      halo,
      label,
      radius,
      center: new THREE.Vector3(def.x, def.y, def.z),
      passed: false,
      accuracy: 0, // 0..1, 1 = dead centre
      active: false,
    });
  });
  return {
    list: rings,
    setActive(idx) {
      rings.forEach((r, i) => {
        r.active = i === idx;
        if (r.passed) {
          r.torus.material.emissive.setHex(0x1fae54);
          r.torus.material.emissiveIntensity = 0.9;
          r.halo.material.color.setHex(0x2aff5a);
          r.halo.material.opacity = 0.18;
        } else if (r.active) {
          r.torus.material.emissive.setHex(0x18c8a8);
          r.torus.material.emissiveIntensity = 1.6;
          r.halo.material.color.setHex(0x18e8c8);
          r.halo.material.opacity = 0.4;
        } else {
          r.torus.material.emissive.setHex(0x8a6a1a);
          r.torus.material.emissiveIntensity = 0.7;
          r.halo.material.color.setHex(0xffb020);
          r.halo.material.opacity = 0.12;
        }
      });
    },
    // Returns the ring just passed (with accuracy), or null.
    checkPass(pos) {
      for (const r of rings) {
        if (r.passed || !r.active) continue;
        const d = pos.distanceTo(r.center);
        if (d < r.radius) {
          r.passed = true;
          r.accuracy = clamp(1 - d / r.radius, 0, 1);
          return r;
        }
      }
      return null;
    },
    next() {
      return rings.find((r) => !r.passed) || null;
    },
    passedCount() {
      return rings.filter((r) => r.passed).length;
    },
    update(dt, time, dronePos) {
      // Pulse the active ring; refresh the next ring's distance label.
      for (const r of rings) {
        if (r.active && !r.passed) {
          const pulse = 1.35 + Math.sin(time * 4) * 0.35;
          r.torus.material.emissiveIntensity = pulse;
          const d = Math.round(dronePos.distanceTo(r.center));
          drawLabel(r.label, `RING ${r.index + 1}  •  ${d} m`, '#4df0c8');
        } else if (r.passed) {
          drawLabel(r.label, `RING ${r.index + 1}  •  CLEAR`, '#4dff7a');
        } else {
          drawLabel(r.label, `RING ${r.index + 1}`, '#ffb020');
        }
        // Labels always face the camera (sprites do this themselves).
      }
    },
    dispose() {
      for (const r of rings) {
        r.group.parent?.remove(r.group);
        r.torus.geometry.dispose();
        r.halo.geometry.dispose();
      }
      rings.length = 0;
    },
  };
}
