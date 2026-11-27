// Operation: Sky Hunter — the drone's ground shadow.
//
// A soft blob shadow projected onto the terrain beneath the drone: it
// grounds the aircraft visually, grows and fades as the drone climbs, and
// gives the pilot a depth cue when flying low. It is a flat gradient
// plane (no shadow-map cost) and never touches gameplay — the real
// shadow map still handles the drone's own cast shadow.

const THREE = window.THREE;

function makeBlobTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.65)');
  grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.34)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

export function createDroneShadow(scene) {
  const mat = new THREE.MeshBasicMaterial({
    map: makeBlobTexture(), transparent: true, depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 1;
  mesh.visible = false;
  scene.add(mesh);
  return {
    update(flightPos, groundY) {
      const agl = flightPos.y - groundY;
      if (agl > 260) {
        mesh.visible = false;
        return;
      }
      mesh.visible = true;
      mesh.position.set(flightPos.x, groundY + 0.4, flightPos.z);
      const s = 1 + Math.min(agl, 160) / 160 * 0.9;
      mesh.scale.set(s, s, 1);
      mat.opacity = 0.65 * Math.exp(-agl / 55);
    },
  };
}
